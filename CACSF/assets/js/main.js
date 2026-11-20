
document.addEventListener("DOMContentLoaded", () => {
  // Automatically update current year
  const year = document.querySelectorAll("[data-year]");
  year.forEach(el => el.textContent = new Date().getFullYear());

  // Mobile menu toggle
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
  }

  // Navigation dropdown
  document.querySelectorAll(".nav-drop-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.parentElement.classList.toggle("show");
    });
  });

  // Theme toggle
  const themeButtons = document.querySelectorAll(".theme-toggle");

  const setTheme = theme => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("cacsf-theme", theme);

    themeButtons.forEach(b => {
      b.textContent = theme === "dark" ? "☀" : "☾";
    });
  };

  setTheme(localStorage.getItem("cacsf-theme") || "light");

  themeButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      setTheme(
        document.documentElement.dataset.theme === "dark"
          ? "light"
          : "dark"
      );
    });
  });

  // Birthday day dropdown
  const daySelect = document.querySelector('select[name="birth_day"]');

  if (daySelect) {
    daySelect.innerHTML = '<option value="">Select day</option>';

    for (let d = 1; d <= 31; d++) {
      const suffix =
        (d % 100 >= 11 && d % 100 <= 13)
          ? "th"
          : ({1:"st", 2:"nd", 3:"rd"}[d % 10] || "th");

      daySelect.add(new Option(`${d}${suffix}`, d));
    }
  }

  // Graduation year dropdown - Academic sessions
  const grad = document.getElementById("graduation-year");

  if (grad) {
    grad.innerHTML = '<option value="">Select year</option>';

    for (let y = 1995; y <= 2025; y++) {
      const session = `${y}/${y + 1}`;
      grad.add(new Option(session, session));
    }
  }

  // Media gallery
  document.querySelectorAll("[data-media-gallery]").forEach(loadGallery);

  // Project gallery
  document.querySelectorAll("[data-project-gallery]").forEach(loadProjectGallery);
});


// Load Media Gallery
async function loadGallery(container) {
  if (!window.cacsfSupabaseReady) return;

  const year = container.dataset.year;
  const category = container.dataset.mediaGallery;

  const { data, error } = await window.cacsf.supabase
    .from("media")
    .select("*")
    .eq("year", Number(year))
    .eq("category", category)
    .order("created_at", { ascending: false });

  if (error || !data || !data.length) return;

  container.innerHTML = "";

  data.forEach(item => {
    const url = window.cacsf.supabase
      .storage
      .from(window.CACSF_STORAGE_BUCKET)
      .getPublicUrl(item.file_path).data.publicUrl;

    if (category === "videos") {
      const card = document.createElement("article");
      card.className = "video-card";

      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      video.preload = "metadata";

      const caption = document.createElement("p");
      caption.textContent = item.caption || "Reunion video";

      card.append(video, caption);
      container.append(card);

    } else {
      const a = document.createElement("a");
      a.className = "gallery-item";
      a.href = url;
      a.target = "_blank";

      const img = document.createElement("img");
      img.src = url;
      img.alt = item.caption || `${year} reunion ${category}`;

      const cap = document.createElement("span");
      cap.textContent = item.caption || "View image";

      a.append(img, cap);
      container.append(a);
    }
  });
}


// Load Project Gallery
async function loadProjectGallery(container) {
  if (!window.cacsfSupabaseReady) return;

  const { data, error } = await window.cacsf.supabase
    .from("project_gallery")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data || !data.length) return;

  container.innerHTML = "";

  data.forEach(item => {
    const url = window.cacsf.supabase
      .storage
      .from(window.CACSF_STORAGE_BUCKET)
      .getPublicUrl(item.file_path).data.publicUrl;

    const a = document.createElement("a");
    a.className = "gallery-item";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";

    const img = document.createElement("img");
    img.src = url;
    img.alt = item.caption || "CACSF project update";

    const cap = document.createElement("span");
    cap.textContent = item.caption || "Project update";

    a.append(img, cap);
    container.append(a);
  });
}
