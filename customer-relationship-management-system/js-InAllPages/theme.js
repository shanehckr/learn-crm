(function () {
  "use strict";

  const root = document.documentElement;
  const lightTheme = "light-mode";
  const darkTheme = "dark-mode";

  function readSavedTheme() {
    try {
      const savedTheme = localStorage.getItem("theme");
      return savedTheme === lightTheme || savedTheme === darkTheme
        ? savedTheme
        : null;
    } catch (error) {
      console.warn("Could not read the saved theme preference.", error);
      return null;
    }
  }

  function applyTheme(theme) {
    const isDark = theme === darkTheme;
    root.classList.remove(lightTheme, darkTheme);
    root.classList.add(isDark ? darkTheme : lightTheme);
    root.style.backgroundColor = isDark ? "#050d0a" : "#ffffff";

    const toggle = document.getElementById("themeToggle");
    if (toggle) {
      const nextTheme = isDark ? "light" : "dark";
      toggle.setAttribute("aria-label", "Switch to " + nextTheme + " mode");
      toggle.setAttribute("title", "Switch to " + nextTheme + " mode");
      toggle.setAttribute("aria-pressed", String(isDark));
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem("theme", theme);
    } catch (error) {
      console.warn("Could not save the theme preference.", error);
    }
  }

  const savedTheme = readSavedTheme();
  const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const preferredTheme = colorSchemeQuery.matches
    ? darkTheme
    : lightTheme;
  applyTheme(savedTheme || preferredTheme);

  document.addEventListener("DOMContentLoaded", function () {
    const toggle = document.getElementById("themeToggle");
    if (toggle) {
      applyTheme(root.classList.contains(darkTheme) ? darkTheme : lightTheme);
      toggle.addEventListener("click", function () {
        const nextTheme = root.classList.contains(darkTheme) ? lightTheme : darkTheme;
        applyTheme(nextTheme);
        saveTheme(nextTheme);
      });
    }
  });

  if (!savedTheme) {
    colorSchemeQuery.addEventListener("change", function (event) {
      applyTheme(event.matches ? darkTheme : lightTheme);
    });
  }
})();
