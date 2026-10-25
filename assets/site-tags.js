/*
 * Ads & analytics settings for javaplay.codelove.in — change the IDs here; leave one "" to turn it off.
 * (The AdSense ID is also in each page's <meta name="google-adsense-account">, for site verification.)
 * Loaded only on the live site: never inside the Android app (served as keyplay.app) or in a frame,
 * because AdSense isn't allowed in app WebViews.
 */
(function () {
  var ADSENSE_CLIENT = "ca-pub-1282068947061740";
  var GA_MEASUREMENT_ID = "G-65L0LB1CJT";

  if (location.hostname !== "javaplay.codelove.in" || window.parent !== window) return;
  function load(src, cors) {
    var s = document.createElement("script");
    s.async = true;
    s.src = src;
    if (cors) s.crossOrigin = "anonymous";
    document.head.appendChild(s);
  }
  if (ADSENSE_CLIENT) load("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + ADSENSE_CLIENT, true);
  if (GA_MEASUREMENT_ID) {
    load("https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID, false);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_MEASUREMENT_ID);
  }
})();
