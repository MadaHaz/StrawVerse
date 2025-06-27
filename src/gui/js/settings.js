let originalSettings = {};

window.sharedStateAPI.on("mal", (data) => {
  let LoggedIn = data?.LoggedIn;
  document.getElementById("connectMal").hidden = LoggedIn;
  document.getElementById("myAnimeList-logout").hidden = !LoggedIn;
  document.getElementById("myAnimeList-config").hidden = !LoggedIn;
});

window.sharedStateAPI.on("extention-updated", (data) => {
  // Anime Provider
  const animeSelect = document.getElementById("anime-provider");
  const currentAnimeProvider = animeSelect.value;

  if (data?.Anime?.length > 0) {
    animeSelect.innerHTML = data.Anime.map(
      (name) => `<option value="${name.name}">${name.name}</option>`
    ).join("");
  } else {
    animeSelect.innerHTML = "";
  }

  if (
    Array.from(animeSelect.options).some(
      (opt) => opt.value === currentAnimeProvider
    )
  ) {
    animeSelect.value = currentAnimeProvider;
  } else {
    animeSelect.value = null;
  }

  // Manga Provider
  const mangaSelect = document.getElementById("manga-provider");
  const currentMangaProvider = mangaSelect.value;

  if (data?.Manga?.length > 0) {
    mangaSelect.innerHTML = data.Manga.map(
      (name) => `<option value="${name.name}">${name.name}</option>`
    ).join("");
  } else {
    mangaSelect.innerHTML = "";
  }

  if (
    Array.from(mangaSelect.options).some(
      (opt) => opt.value === currentMangaProvider
    )
  ) {
    mangaSelect.value = currentMangaProvider;
  } else {
    mangaSelect.value = null;
  }

  checkForChanges();
});

function showSection(targetId) {
  document.querySelectorAll(".settings-section").forEach((section) => {
    section.style.display = section.id === targetId ? "block" : "none";
  });
}

function showLoadingAnimation() {
  document.getElementById("overlay").style.display = "block";
}

function hideLoadingAnimation() {
  document.getElementById("overlay").style.display = "none";
}

function submitSettings(event) {
  event.preventDefault();

  const data = {
    quality: document.getElementById("quality-select")?.value || null,
    Animeprovider: document.getElementById("anime-provider")?.value || null,
    Mangaprovider: document.getElementById("manga-provider")?.value || null,
    CustomDownloadLocation:
      document.getElementById("download-location")?.value || "",
    Pagination: document.getElementById("pagination")?.value || null,
    autoLoadNextChapter:
      document.getElementById("auto-load-next-chapter-select")?.value || null,
    autotrack: document.getElementById("malautotrack")?.value || null,
    status: document.getElementById("malstatus")?.value || null,
    enableDiscordRPC:
      document.getElementById("discord-rpc-status-select")?.value || null,
  };

  document.getElementById("save-settings").style.display = "none";
  showLoadingAnimation();

  fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
    .then((response) => response.json())
    .then((responseData) => {
      hideLoadingAnimation();
      if (responseData.message) {
        Swal.fire({
          icon: "success",
          title: "Updated Config",
          html: `<pre>${responseData.message}</pre>`,
        });

        // Update originalSettings to new saved values
        originalSettings = { ...data };
        document.getElementById("save-settings").style.display = "none";
      } else {
        Swal.fire({
          icon: "error",
          title: "Oops Error :P",
          text: `${responseData.error}`,
        });
      }
    })
    .catch((error) => {
      hideLoadingAnimation();
      console.error("Error:", error);
      Swal.fire({
        icon: "error",
        title: "Failed To Update Config",
        text: "Something Went Wrong",
      });
    });
}

function redirectToUrl(url) {
  window.location.href = url;
}

function MalLogout() {
  fetch("./mal/logout");
}

function checkForChanges() {
  const currentSettings = {
    quality: document.getElementById("quality-select")?.value || null,
    Animeprovider: document.getElementById("anime-provider")?.value || null,
    Mangaprovider: document.getElementById("manga-provider")?.value || null,
    CustomDownloadLocation:
      document.getElementById("download-location")?.value || "",
    Pagination: document.getElementById("pagination")?.value || null,
    autoLoadNextChapter:
      document.getElementById("auto-load-next-chapter-select")?.value || null,
    autotrack: document.getElementById("malautotrack")?.value || null,
    status: document.getElementById("malstatus")?.value || null,
    enableDiscordRPC:
      document.getElementById("discord-rpc-status-select")?.value || null,
  };

  const changed = Object.keys(originalSettings).some(
    (key) => originalSettings[key] !== currentSettings[key]
  );

  document.getElementById("save-settings").style.display = changed
    ? "block"
    : "none";
}

function init(url, settings) {
  originalSettings = {
    quality: settings?.quality ?? "1080p",
    Animeprovider: settings?.Animeprovider ?? null,
    Mangaprovider: settings?.Mangaprovider ?? null,
    CustomDownloadLocation: settings?.CustomDownloadLocation ?? "",
    Pagination: settings?.pagination ?? "on",
    autoLoadNextChapter: settings?.autoLoadNextChapter ?? "on",
    autotrack: settings?.malautotrack ?? "off",
    status: settings?.status ?? "plan_to_watch",
    enableDiscordRPC: settings?.enableDiscordRPC ?? "off",
  };

  const UrlPresent = url && url?.length > 0;
  document.getElementById("connectMal").hidden = !UrlPresent;
  document.getElementById("myAnimeList-logout").hidden = UrlPresent;
  document.getElementById("myAnimeList-config").hidden = UrlPresent;

  const animeSelect = document.getElementById("anime-provider");
  if (settings?.providers?.Anime?.length > 0) {
    animeSelect.innerHTML = settings.providers.Anime.map(
      (name) =>
        `<option value="${name}" ${
          name === originalSettings.Animeprovider ? "selected" : ""
        }>${name}</option>`
    ).join("");
  }

  const mangaSelect = document.getElementById("manga-provider");
  if (settings?.providers?.Manga?.length > 0) {
    mangaSelect.innerHTML = settings.providers.Manga.map(
      (name) =>
        `<option value="${name}" ${
          name === originalSettings.Mangaprovider ? "selected" : ""
        }>${name}</option>`
    ).join("");
  }

  document.getElementById("malstatus").value = originalSettings.status;
  document.getElementById("malautotrack").value = originalSettings.autotrack;
  document.getElementById("quality-select").value = originalSettings.quality;
  document.getElementById("auto-load-next-chapter-select").value =
    originalSettings.autoLoadNextChapter;
  document.getElementById("pagination").value = originalSettings.Pagination;
  document.getElementById("discord-rpc-status-select").value =
    originalSettings.enableDiscordRPC;
  document.getElementById("download-location").value =
    originalSettings.CustomDownloadLocation;

  document.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", checkForChanges);
    input.addEventListener("change", checkForChanges);
  });

  document.getElementById("save-settings").style.display = "none";
  showSection("utils");
}
