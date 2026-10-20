# Methods called from JavaScript must keep their names
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
