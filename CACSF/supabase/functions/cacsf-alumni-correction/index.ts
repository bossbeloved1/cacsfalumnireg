import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.10.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;
const SITE_URL = Deno.env.get("CACSF_SITE_URL")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const BUCKET = Deno.env.get("CACSF_STORAGE_BUCKET") || "cacsf-media";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function sendResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return sendResponse({ error: "Method not allowed." }, 405);

  try {
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "request") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendResponse({ error: "Enter a valid email address." }, 400);
      }

      const { data: alumni, error: lookupError } = await supabase
        .from("alumni").select("id,email").ilike("email", email).maybeSingle();

      if (lookupError) {
        console.error("Alumni lookup failed:", lookupError.message);
        return sendResponse({ error: "Unable to process your request right now." }, 500);
      }
      if (!alumni) {
        return sendResponse({
          success: false,
          error: "This email address is not registered in our alumni database. Please check the email address and try again.",
          code: "EMAIL_NOT_REGISTERED",
        });
      }

      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { data: recentToken, error: recentError } = await supabase
        .from("alumni_correction_tokens").select("token_hash")
        .eq("alumni_id", alumni.id).gt("created_at", oneMinuteAgo).limit(1).maybeSingle();

      if (recentError) {
        console.error("Rate-limit check failed:", recentError.message);
        return sendResponse({ error: "Unable to process your request right now." }, 500);
      }
      if (recentToken) {
        return sendResponse({
          success: true,
          message: "A correction link was recently sent to this email address. Please check your inbox and spam folder, or wait one minute before requesting another.",
          code: "RECENT_REQUEST",
        });
      }

      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const { error: deleteError } = await supabase
        .from("alumni_correction_tokens").delete().eq("alumni_id", alumni.id);
      if (deleteError) {
        console.error("Token cleanup failed:", deleteError.message);
        return sendResponse({ error: "Unable to process your request right now." }, 500);
      }

      const { error: insertError } = await supabase
        .from("alumni_correction_tokens")
        .insert({ token_hash: tokenHash, alumni_id: alumni.id, expires_at: expiresAt });
      if (insertError) {
        console.error("Token creation failed:", insertError.message);
        return sendResponse({ error: "Unable to process your request right now." }, 500);
      }

      const correctionLink = SITE_URL.replace(/\/+$/, "") + "/correction.html?token=" + token;
      try {
        await transporter.sendMail({
          from: GMAIL_USER,
          to: alumni.email,
          subject: "Your CACSF registration correction link",
          text: "CACSF ALUMNI FELLOWSHIP\n\nWe received a request to correct your alumni registration details.\n\nOpen the link below within 30 minutes:\n\n" +
            correctionLink + "\n\nThis link can only be used once.\n\nIf you did not request this correction, please ignore this email.\n\nCACSF Alumni Fellowship",
        });
      } catch (mailError) {
        console.error("Email sending failed:", mailError);
        await supabase.from("alumni_correction_tokens").delete().eq("token_hash", tokenHash);
        return sendResponse({ error: "The correction email could not be sent. Please try again later." }, 500);
      }

      return sendResponse({
        success: true,
        message: "Your correction link has been sent successfully. Please check your email inbox and spam folder.",
      });
    }

    if (action === "verify") {
      const token = String(body.token || "").trim();
      if (!/^[a-f0-9]{64}$/i.test(token)) return sendResponse({ error: "This correction link is invalid." }, 400);

      const tokenHash = await hashToken(token);
      const { data: tokenRecord, error: tokenError } = await supabase
        .from("alumni_correction_tokens").select("alumni_id")
        .eq("token_hash", tokenHash).is("used_at", null)
        .gt("expires_at", new Date().toISOString()).maybeSingle();

      if (tokenError || !tokenRecord) {
        return sendResponse({ error: "This link is invalid, expired, or has already been used." }, 400);
      }

      const { data: alumni, error: alumniError } = await supabase
        .from("alumni")
        .select("id,alias,first_name,surname,email,birth_month,birth_day,graduation_year,phone,profession")
        .eq("id", tokenRecord.alumni_id).maybeSingle();

      if (alumniError || !alumni) return sendResponse({ error: "Registration details could not be found." }, 404);
      return sendResponse({ success: true, alumni });
    }

    if (action === "update") {
      const token = String(body.token || "").trim();
      if (!/^[a-f0-9]{64}$/i.test(token)) return sendResponse({ error: "This correction link is invalid." }, 400);

      const alias = String(body.alias || "").trim();
      const firstName = String(body.first_name || "").trim();
      const surname = String(body.surname || "").trim();
      const birthMonth = String(body.birth_month || "").trim();
      const birthDay = Number(body.birth_day);
      const graduationYear = Number(body.graduation_year);
      const phone = String(body.phone || "").trim();
      const profession = String(body.profession || "").trim();

      if (!alias || !firstName || !surname || !birthMonth || !phone ||
        !Number.isInteger(birthDay) || birthDay < 1 || birthDay > 31 ||
        !Number.isInteger(graduationYear) || graduationYear < 1995 ||
        graduationYear > new Date().getFullYear()) {
        return sendResponse({ error: "Please check and complete all required fields." }, 400);
      }

      const tokenHash = await hashToken(token);
      const now = new Date().toISOString();
      const { data: validToken, error: tokenCheckError } = await supabase
        .from("alumni_correction_tokens").select("alumni_id")
        .eq("token_hash", tokenHash).is("used_at", null)
        .gt("expires_at", now).maybeSingle();

      if (tokenCheckError || !validToken) {
        return sendResponse({ error: "This link is invalid, expired, or has already been used." }, 400);
      }

      // Atomically consume the correction link before changing the record.
      const { data: consumed, error: consumeError } = await supabase
        .from("alumni_correction_tokens").update({ used_at: now })
        .eq("token_hash", tokenHash).is("used_at", null)
        .gt("expires_at", now).select("alumni_id").maybeSingle();

      if (consumeError || !consumed) {
        return sendResponse({ error: "This link is invalid, expired, or has already been used." }, 400);
      }

      const updateData: Record<string, unknown> = {
        alias, first_name: firstName, surname, birth_month: birthMonth,
        birth_day: birthDay, graduation_year: graduationYear, phone,
        profession: profession || null,
      };

      let newPhotoPath: string | null = null;
      const oldPhotoQuery = await supabase.from("alumni").select("photo_path")
        .eq("id", validToken.alumni_id).maybeSingle();
      if (oldPhotoQuery.error || !oldPhotoQuery.data) {
        return sendResponse({ error: "Registration details could not be found." }, 404);
      }

      if (body.photo_base64 || body.photo_content_type) {
        const contentType = String(body.photo_content_type || "");
        if (!["image/jpeg", "image/png", "image/gif"].includes(contentType) ||
          typeof body.photo_base64 !== "string") {
          return sendResponse({ error: "Choose a valid JPG, PNG or GIF photograph." }, 400);
        }
        let binary: Uint8Array;
        try {
          binary = Uint8Array.from(atob(body.photo_base64), (c) => c.charCodeAt(0));
        } catch {
          return sendResponse({ error: "The selected photograph could not be read." }, 400);
        }
        if (!binary.length || binary.length > MAX_PHOTO_BYTES) {
          return sendResponse({ error: "The profile photograph must not exceed 5MB." }, 400);
        }

        const extension = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
        newPhotoPath = `alumni/${validToken.alumni_id}/profile-${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET)
          .upload(newPhotoPath, binary, { contentType, upsert: false });
        if (uploadError) {
          console.error("Profile photo upload failed:", uploadError.message);
          return sendResponse({ error: "The new profile photograph could not be uploaded. Please try again." }, 500);
        }
        updateData.photo_path = newPhotoPath;
      }

      const { error: updateError } = await supabase.from("alumni")
        .update(updateData).eq("id", validToken.alumni_id);
      if (updateError) {
        if (newPhotoPath) await supabase.storage.from(BUCKET).remove([newPhotoPath]);
        console.error("Registration update failed:", updateError.message);
        return sendResponse({ error: "Your details could not be updated. Please contact the alumni administrators." }, 500);
      }

      const oldPhotoPath = oldPhotoQuery.data.photo_path;
      if (newPhotoPath && oldPhotoPath && oldPhotoPath !== newPhotoPath) {
        const { error: removeError } = await supabase.storage.from(BUCKET).remove([oldPhotoPath]);
        if (removeError) console.warn("Old profile photo cleanup failed:", removeError.message);
      }

      return sendResponse({
        success: true,
        message: "Your registration details have been corrected successfully.",
      });
    }

    return sendResponse({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("Correction function error:", error);
    return sendResponse({ error: "An unexpected error occurred. Please try again." }, 500);
  }
});
