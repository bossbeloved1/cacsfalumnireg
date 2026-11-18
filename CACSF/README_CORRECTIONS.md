# CACSF Alumni Website — Updated Project

This package preserves the existing website structure and includes the agreed November 2026 updates.

## Included changes
- Registration now requires email address and phone number; Profession / Occupation remains optional.
- Correction request returns a clear success response for registered email addresses and an error response for addresses not found in the alumni table.
- Correction page supports optional profile photograph replacement with preview and file validation. The Edge Function uploads the new image and updates the existing alumni row.
- Monthly dashboard folders are now the 12 birthday months and are grouped by `birth_month`, not `created_at`. The original `created_at` registration timestamp remains unchanged.
- Monitoring & Security includes activity filters, row selection, Clear Selected and Clear All routine activity controls. The database RPC enforces Super Admin access and protects security/login audit records.

## Supabase steps required
1. Back up the Supabase project/database.
2. Open Supabase SQL Editor and run `supabase/cacsf_updates_november_2026.sql`.
   - This migration expects the existing dashboard's `public.admin_activity` table and `public.is_cacsf_super_admin()` function to exist. These are used by the current dashboard's Monitoring & Security module.
   - The email/phone checks are added as `NOT VALID`: new inserts and updates must satisfy them, while older incomplete records are not deleted.
3. Deploy `supabase/functions/cacsf-alumni-correction/index.ts` as the Edge Function named `cacsf-alumni-correction`.
4. Ensure the Edge Function secrets are configured: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `CACSF_SITE_URL`. Optional: `CACSF_STORAGE_BUCKET` (defaults to `cacsf-media`).
5. Confirm the `cacsf-media` Storage bucket exists and is configured as the site's public media bucket. The Edge Function uses the service-role key server-side to upload/replace profile images. Never put the service-role key in browser code.
6. Test with a registered email and an unregistered email, then test a correction link with and without a replacement photo.
7. Sign in as a Super Admin and test activity clearing. Login/security events should remain after clearing routine activity.

## Important
- The SQL migration does not reclassify or recreate alumni records. The dashboard reads each existing `birth_month` value and displays the record in the matching birthday folder.
- The ZIP does not contain Supabase secrets or credentials.
- Apply the SQL migration and deploy the Edge Function before expecting the new backend-dependent features to work in production.
