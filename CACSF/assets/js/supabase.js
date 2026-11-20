
(() => {
  const configured =
    window.supabase &&
    window.CACSF_SUPABASE_URL &&
    !window.CACSF_SUPABASE_URL.startsWith("YOUR_") &&
    window.CACSF_SUPABASE_ANON_KEY &&
    !window.CACSF_SUPABASE_ANON_KEY.startsWith("YOUR_");

  if (configured) {
    window.cacsf = {
      supabase: window.supabase.createClient(
        window.CACSF_SUPABASE_URL,
        window.CACSF_SUPABASE_ANON_KEY
      )
    };
    window.cacsfSupabaseReady = true;
  } else {
    window.cacsfSupabaseReady = false;
  }

  /* =========================================
     PHOTO OPTIMIZATION
  ========================================= */

  async function optimizePhoto(file) {
    // Preserve animated GIF files.
    if (file.type === "image/gif") {
      return file;
    }

    // Only optimize JPEG and PNG images.
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      return file;
    }

    // Skip already-small photographs.
    if (file.size <= 300 * 1024) {
      return file;
    }

    try {
      if (!("createImageBitmap" in window)) {
        return file;
      }

      const bitmap = await createImageBitmap(file);

      const maxDimension = 1000;
      const scale = Math.min(
        1,
        maxDimension / Math.max(bitmap.width, bitmap.height)
      );

      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");

      if (!context) {
        bitmap.close();
        return file;
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);

      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, "image/jpeg", 0.70);
      });

      if (!blob || blob.size >= file.size) {
        return file;
      }

      const optimizedName =
        file.name.replace(/\.[^.]+$/, "") + ".jpg";

      return new File([blob], optimizedName, {
        type: "image/jpeg",
        lastModified: Date.now()
      });

    } catch (error) {
      console.warn("Photo optimization skipped:", error);
      return file;
    }
  }

  /* =========================================
     CACSF SUCCESS CELEBRATION
  ========================================= */

  function showBirthdayCelebration() {
    if (document.getElementById("cacsf-celebration")) return;

    const overlay = document.createElement("div");
    overlay.id = "cacsf-celebration";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "cacsf-celebration-title");

    overlay.innerHTML = `
      <style>
        #cacsf-celebration {
          position: fixed;
          inset: 0;
          z-index: 100000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(2, 15, 8, .86);
          backdrop-filter: blur(12px);
          animation: cacsfFadeIn .45s ease both;
          overflow: hidden;
        }

        #cacsf-celebration .celebration-card {
          position: relative;
          z-index: 2;
          width: min(100%, 490px);
          padding: 42px 30px;
          text-align: center;
          color: #143622;
          background: linear-gradient(145deg, #ffffff, #eaffed);
          border: 2px solid rgba(255,255,255,.8);
          border-radius: 28px;
          box-shadow: 0 0 35px rgba(67,255,117,.25),
                      0 0 100px rgba(67,255,117,.16),
                      0 25px 80px rgba(0,0,0,.35);
          animation: cacsfPop .65s cubic-bezier(.2,.8,.3,1.3) both;
        }

        #cacsf-celebration .success-glow {
          width: 105px;
          height: 105px;
          margin: 0 auto 22px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          color: white;
          font-size: 49px;
          font-weight: 800;
          background: radial-gradient(circle at 35% 30%, #a7ffb5, #24c653 60%, #08752e);
          box-shadow: 0 0 0 10px rgba(53,228,92,.12),
                      0 0 35px rgba(35,220,85,.75);
          animation: cacsfPulse 1.8s ease-in-out infinite;
        }

        #cacsf-celebration .celebration-label {
          display: block;
          margin-bottom: 12px;
          color: #21813e;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 3px;
        }

        #cacsf-celebration h2 {
          margin: 0 auto 17px;
          color: #123c24;
          font: 800 clamp(23px, 5vw, 34px)/1.15 Manrope, sans-serif;
          letter-spacing: -1px;
        }

        #cacsf-celebration .celebration-message {
          margin: 0 auto 25px;
          max-width: 380px;
          color: #245438;
          font: 800 clamp(15px, 3.5vw, 19px)/1.55 Manrope, sans-serif;
          letter-spacing: .3px;
        }

        #cacsf-celebration .celebration-close {
          border: 0;
          border-radius: 30px;
          padding: 14px 28px;
          color: white;
          background: linear-gradient(110deg, #159c43, #38d85d);
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(26,170,68,.25);
          transition: transform .2s, filter .2s;
        }

        #cacsf-celebration .celebration-close:hover {
          transform: translateY(-2px);
          filter: brightness(1.08);
        }

        #cacsf-celebration .confetti-piece {
          position: absolute;
          top: -25px;
          width: 9px;
          height: 15px;
          border-radius: 2px;
          pointer-events: none;
          animation: cacsfConfetti linear forwards;
        }

        #cacsf-celebration .sparkle {
          position: absolute;
          color: #c5ffcf;
          font-size: 19px;
          pointer-events: none;
          animation: cacsfSparkle 2s ease-in-out infinite;
        }

        @keyframes cacsfFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes cacsfPop {
          from { opacity: 0; transform: scale(.65) translateY(25px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        @keyframes cacsfPulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 10px rgba(53,228,92,.12),
                        0 0 35px rgba(35,220,85,.75);
          }
          50% {
            transform: scale(1.09);
            box-shadow: 0 0 0 17px rgba(53,228,92,.07),
                        0 0 55px rgba(35,220,85,.9);
          }
        }

        @keyframes cacsfConfetti {
          0% {
            transform: translate3d(0,-10px,0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translate3d(var(--drift),110vh,0) rotate(900deg);
            opacity: 0;
          }
        }

        @keyframes cacsfSparkle {
          0%,100% { opacity: .25; transform: scale(.7) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.3) rotate(45deg); }
        }

        @media(max-width:480px) {
          #cacsf-celebration .celebration-card {
            padding: 35px 21px;
            border-radius: 22px;
          }

          #cacsf-celebration .success-glow {
            width: 85px;
            height: 85px;
            font-size: 40px;
          }
        }

        @media(prefers-reduced-motion:reduce) {
          #cacsf-celebration *,
          #cacsf-celebration *::before {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
          }
        }

        /* Improved mobile success celebration */
        @media(max-width:560px) {
          #cacsf-celebration {
            padding: 12px;
            overflow-y: auto;
          }

          #cacsf-celebration .celebration-card {
            width: 100%;
            max-height: calc(100vh - 24px);
            max-height: calc(100dvh - 24px);
            overflow-y: auto;
            padding: 28px 18px;
          }

          #cacsf-celebration .success-glow {
            width: 85px;
            height: 85px;
            font-size: 40px;
          }

          #cacsf-celebration h2 {
            font-size: clamp(22px, 6vw, 30px);
          }

          #cacsf-celebration .celebration-message {
            font-size: clamp(14px, 4vw, 17px);
          }
        }

        /* Keep the requested mobile animations visible */
        @media(max-width:560px) and (prefers-reduced-motion:reduce) {
          #cacsf-celebration .celebration-card {
            animation-duration: .65s !important;
          }

          #cacsf-celebration .success-glow {
            animation-duration: 1.8s !important;
            animation-iteration-count: infinite !important;
          }

          #cacsf-celebration .confetti-piece {
            animation-duration: 9.6s !important;
            animation-iteration-count: 1 !important;
          }

          #cacsf-celebration .sparkle {
            animation-duration: 2s !important;
            animation-iteration-count: infinite !important;
          }
        }
      </style>

      <div class="celebration-card">
        <div class="success-glow" aria-hidden="true">✓</div>
        <span class="celebration-label">CACSF ALUMNI FELLOWSHIP</span>
        <h2 id="cacsf-celebration-title">REGISTRATION SUCCESSFUL!</h2>
        <p class="celebration-message">
          HAPPY BIRTHDAY TO YOU IN ADVANCE, WE LOVE AND CELEBRATE YOU.
        </p>
        <button type="button" class="celebration-close">Thank you! Close</button>
      </div>
    `;

    document.body.appendChild(overlay);

    const isSmallScreen = window.matchMedia("(max-width: 560px)").matches;

    const confettiColors = [
      "#35e45c",
      "#b6ed43",
      "#ffffff",
      "#ffd166",
      "#69d9ff",
      "#ff8bc2"
    ];

    for (let i = 0; i < 100; i++) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "%";
      piece.style.background =
        confettiColors[Math.floor(Math.random() * confettiColors.length)];

      piece.style.animationDuration = isSmallScreen
        ? "9.6s"
        : (3 + Math.random() * 4) + "s";

      piece.style.animationDelay = isSmallScreen
        ? (Math.random() * 0.4) + "s"
        : (Math.random() * 2) + "s";

      piece.style.setProperty(
        "--drift",
        (Math.random() * 240 - 120) + "px"
      );

      overlay.appendChild(piece);
    }

    for (let i = 0; i < 18; i++) {
      const sparkle = document.createElement("span");
      sparkle.className = "sparkle";
      sparkle.textContent = "✦";
      sparkle.style.left = Math.random() * 100 + "%";
      sparkle.style.top = Math.random() * 100 + "%";
      sparkle.style.animationDelay = Math.random() * 2 + "s";
      overlay.appendChild(sparkle);
    }

    const closeButton = overlay.querySelector(".celebration-close");

    function closeCelebration() {
      overlay.remove();
      document.removeEventListener("keydown", handleEscape);
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        closeCelebration();
      }
    }

    closeButton.addEventListener("click", closeCelebration);
    document.addEventListener("keydown", handleEscape);
    closeButton.focus();
  }

  /* =========================================
     CUSTOM ALUMNI TITLE
  ========================================= */

  const alumniTitleSelect = document.getElementById("alumni-title");
  const customAlumniTitle = document.getElementById("custom-alumni-title");

  if (alumniTitleSelect && customAlumniTitle) {
    alumniTitleSelect.addEventListener("change", () => {
      const isOther = alumniTitleSelect.value === "Others";

      customAlumniTitle.hidden = !isOther;
      customAlumniTitle.disabled = !isOther;
      customAlumniTitle.required = isOther;

      if (!isOther) {
        customAlumniTitle.value = "";
      } else {
        customAlumniTitle.focus();
      }
    });
  }

  /* =========================================
     ALUMNI REGISTRATION
  ========================================= */

  const alumniForm = document.getElementById("alumni-form");

  if (alumniForm) {
    alumniForm.addEventListener("submit", async e => {
      e.preventDefault();

      const status = document.getElementById("alumni-status");
      const submitButton = alumniForm.querySelector(
        'button[type="submit"]'
      );

      if (!window.cacsfSupabaseReady) {
        status.textContent =
          "Supabase is not configured yet. Add your project URL and anon key in assets/js/config.js.";
        return;
      }

      if (!alumniForm.reportValidity()) return;

      const f = new FormData(alumniForm);
      const file = f.get("photo");

      const selectedTitle = String(f.get("alias") || "").trim();
      const customTitle = String(f.get("custom_alias") || "").trim();

      const finalTitle = selectedTitle === "Others"
        ? customTitle
        : selectedTitle;

      if (!finalTitle) {
        status.textContent = "Please enter your title.";
        return;
      }

      if (!String(f.get("email") || "").trim() || !String(f.get("phone") || "").trim()) {
        status.textContent = "Email address and phone number are required.";
        return;
      }

      if (!file || file.size === 0 || file.size > 20 * 1024 * 1024) {
        status.textContent =
          "Please choose a birthday photograph no larger than 20MB.";
        return;
      }

      if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
        status.textContent =
          "Only JPG, JPEG, PNG or GIF images are accepted.";
        return;
      }

      status.textContent = "Preparing your photograph…";

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Submitting…";
      }

      try {
        const consentCheckbox = alumniForm.querySelector(
          'input[name="consent"]'
        );

        if (!consentCheckbox || !consentCheckbox.checked) {
          status.textContent =
            "Please tick the consent checkbox before submitting.";
          return;
        }

        const consentValue = consentCheckbox.checked;

        const optimizationStart = performance.now();

        const optimizedFile = await optimizePhoto(file);

        const optimizationTime =
          ((performance.now() - optimizationStart) / 1000).toFixed(2);

        console.log("Photo optimization:", optimizationTime, "seconds");
        console.log("Original photo size:", (file.size / 1024).toFixed(2), "KB");
        console.log("Optimized photo size:", (optimizedFile.size / 1024).toFixed(2), "KB");
        console.log("Consent selected:", consentValue);

        const ext = optimizedFile.type === "image/jpeg"
          ? "jpg"
          : optimizedFile.type.split("/")[1];

        const safeName = `${crypto.randomUUID()}.${ext}`;
        const path = `alumni/${safeName}`;

        status.textContent = "Uploading photograph…";

        const uploadStart = performance.now();

        const up = await window.cacsf.supabase.storage
          .from(window.CACSF_STORAGE_BUCKET)
          .upload(path, optimizedFile, {
            upsert: false,
            contentType: optimizedFile.type
          });

        const uploadTime =
          ((performance.now() - uploadStart) / 1000).toFixed(2);

        console.log("Photo upload:", uploadTime, "seconds");

        if (up.error) {
          status.textContent = up.error.message;
          return;
        }

        const payload = {
          alias: finalTitle,

          first_name: f.get("first_name"),
          surname: f.get("surname"),
          email: String(f.get("email") || "").trim().toLowerCase(),
          birth_month: f.get("birth_month"),
          birth_day: Number(f.get("birth_day")),
          graduation_year: String(f.get("graduation_year") || "").trim(),
          phone: String(f.get("phone") || "").trim(),
          profession: f.get("profession") || null,

          consent: consentValue,

          photo_path: path
        };

        status.textContent = "Saving your registration…";

        const databaseStart = performance.now();

        const result = await window.cacsf.supabase
          .from("alumni")
          .insert(payload);

        const databaseTime =
          ((performance.now() - databaseStart) / 1000).toFixed(2);

        console.log("Database save:", databaseTime, "seconds");

        if (result.error) {
          status.textContent =
            "Upload completed but the record could not be saved: " +
            result.error.message;
          return;
        }

        alumniForm.reset();

        if (customAlumniTitle) {
          customAlumniTitle.hidden = true;
          customAlumniTitle.disabled = true;
          customAlumniTitle.required = false;
          customAlumniTitle.value = "";
        }

        status.textContent =
          "Thank you! Your details have been submitted successfully.";

        showBirthdayCelebration();

      } catch (error) {
        console.error("CACSF registration error:", error);
        status.textContent =
          "Something went wrong while submitting your details. Please try again.";
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.innerHTML =
            'SUBMIT MY DETAILS <span aria-hidden="true">↗</span>';
        }
      }
    });
  }

  /* =========================================
     CONTACT FORM
  ========================================= */

  const contact = document.getElementById("contact-form");

  if (contact) {
    contact.addEventListener("submit", async e => {
      e.preventDefault();

      const status = document.getElementById("contact-status");

      if (!window.cacsfSupabaseReady) {
        status.textContent =
          "Supabase is not configured. Please contact the fellowship directly.";
        return;
      }

      const f = new FormData(contact);
      status.textContent = "Sending…";

      try {
        const { error } = await window.cacsf.supabase
          .from("messages")
          .insert({
            name: f.get("name"),
            email: f.get("email"),
            subject: f.get("subject"),
            message: f.get("message")
          });

        status.textContent = error
          ? error.message
          : "Your message has been sent. Thank you!";

        if (!error) {
          contact.reset();
        }

      } catch (error) {
        console.error("CACSF contact form error:", error);
        status.textContent =
          "Something went wrong. Please try again.";
      }
    });
  }
})();
