(function () {
  var adEl = document.getElementById("ad");
  if (!adEl) return;

  var fallbackUrl = "https://comspc.duckdns.org";
  var clickTagValue =
    typeof window.clickTag === "string" && window.clickTag.trim().length > 0 ? window.clickTag.trim() : fallbackUrl;

  function openTarget() {
    window.open(clickTagValue, "_blank");
  }

  adEl.addEventListener("click", openTarget);
  adEl.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openTarget();
    }
  });
})();
