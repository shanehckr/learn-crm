(function () {
  // Add the loading overlay to the page.
  function injectLoader() {
    if (!document.getElementById("loadingOverlay")) {
      const loaderHTML = `
        <div id="loadingOverlay" class="loading-overlay hidden d-flex justify-content-center align-items-center">
          <img src="backgroundPicture/background-darkmode.png" class="loader-bg bg-dark" alt="Background Dark">
          <img src="backgroundPicture/background-lightmode.png" class="loader-bg bg-light" alt="Background Light">
          
          <div class="loading-content d-flex flex-column align-items-center text-center">
            <svg class="svg-spinner" viewBox="0 0 50 50">
              <g transform="translate(25, 25)">
                <rect class="dot dot-1" x="-2" y="-20" width="4" height="10" rx="2" />
                <rect class="dot dot-2" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(30)" />
                <rect class="dot dot-3" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(60)" />
                <rect class="dot dot-4" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(90)" />
                <rect class="dot dot-5" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(120)" />
                <rect class="dot dot-6" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(150)" />
                <rect class="dot dot-7" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(180)" />
                <rect class="dot dot-8" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(210)" />
                <rect class="dot dot-9" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(240)" />
                <rect class="dot dot-10" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(270)" />
                <rect class="dot dot-11" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(300)" />
                <rect class="dot dot-12" x="-2" y="-20" width="4" height="10" rx="2" transform="rotate(330)" />
              </g>
            </svg>
            <h2 class="loading-title fw-semibold mb-2">Loading...</h2>
            <p class="loading-subtitle mb-0">Please wait a moment</p>
          </div>
        </div>`;
      document.body.insertAdjacentHTML("afterbegin", loaderHTML);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectLoader);
  } else {
    injectLoader();
  }

  // Expose the global loader controls.
  window.CRMLoader = {
    show: function () {
      const loader = document.getElementById("loadingOverlay");
      if (loader) loader.classList.remove("hidden");
    },
    hide: function () {
      const loader = document.getElementById("loadingOverlay");
      if (loader) loader.classList.add("hidden");
    },
    test: function (seconds = 3) {
      window.CRMLoader.show();
      setTimeout(() => {
        window.CRMLoader.hide();
      }, seconds * 1000);
    }
  };

  // Hide the loader when the page finishes loading.
  window.addEventListener("load", () => {
    window.CRMLoader.hide();
  });

  // Show the loader only when a request takes longer than 300 ms.
  const originalFetch = window.fetch;
  let activeRequests = 0;

  window.fetch = async function (...args) {
    activeRequests++;
    const timer = setTimeout(() => {
      if (activeRequests > 0) window.CRMLoader.show();
    }, 300);

    try {
      const response = await originalFetch(...args);
      return response;
    } finally {
      activeRequests--;
      if (activeRequests <= 0) {
        activeRequests = 0;
        clearTimeout(timer);
        window.CRMLoader.hide();
      }
    }
  };
})();