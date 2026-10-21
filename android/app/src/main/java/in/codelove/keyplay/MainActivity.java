package in.codelove.keyplay;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * JavaPlay: native shell around the JavaPlay J2ME engine (web/engine, written in JavaScript).
 * Assets are served from a private https origin so storage, audio and recording work like a website.
 */
public class MainActivity extends Activity {
	// private origin kept from the KeyPlay days: changing it would wipe every user's saved games and settings
	private static final String ORIGIN = "https://keyplay.app/";
	private static final int PICK_FILES = 1;

	private WebView web;
	private ValueCallback<Uri[]> fileCallback;
	private boolean pageReady;
	private String pendingJarJs;
	private boolean gameMode;

	@SuppressLint("SetJavaScriptEnabled")
	@Override
	protected void onCreate(Bundle savedInstanceState) {
		setTheme(R.style.JavaPlayTheme_Main);
		super.onCreate(savedInstanceState);
		Window w = getWindow();
		w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
		if (Build.VERSION.SDK_INT >= 28) {
			// use the area beside camera cutouts in landscape games
			w.getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
		}
		if (Build.VERSION.SDK_INT >= 21) {
			w.setStatusBarColor(Color.parseColor("#171A21"));
			w.setNavigationBarColor(Color.parseColor("#0E1014"));
		}

		if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
			WebView.setWebContentsDebuggingEnabled(true); // debug builds only: chrome://inspect
		}
		web = new WebView(this);
		web.setBackgroundColor(Color.parseColor("#0E1014"));
		WebSettings s = web.getSettings();
		s.setJavaScriptEnabled(true);
		s.setDomStorageEnabled(true);
		s.setDatabaseEnabled(true);
		s.setMediaPlaybackRequiresUserGesture(false);
		s.setAllowFileAccess(false);
		s.setAllowContentAccess(true);
		s.setSupportZoom(false);
		s.setTextZoom(100);
		web.setOverScrollMode(View.OVER_SCROLL_NEVER);
		web.addJavascriptInterface(new Bridge(), "JavaPlayAndroid");
		web.setWebViewClient(new Client());
		web.setWebChromeClient(new Chrome());
		setContentView(web);

		web.loadUrl(ORIGIN + "play.html");
		handleIntent(getIntent());
	}

	@Override
	protected void onNewIntent(Intent intent) {
		super.onNewIntent(intent);
		handleIntent(intent);
	}

	// "Open with JavaPlay" from a file manager or the browser's downloads
	private void handleIntent(Intent intent) {
		if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
		importJar(intent.getData(), null, true);
	}

	// games downloaded in BrowserActivity, added when this screen comes back
	private static final java.util.concurrent.ConcurrentLinkedQueue<Object[]> jarQueue = new java.util.concurrent.ConcurrentLinkedQueue<>();

	static void queueJar(Uri uri, String name, boolean start) {
		jarQueue.add(new Object[]{uri, name, start});
	}

	private void importJar(Uri uri, String knownName, boolean start) {
		new Thread(() -> {
			try {
				byte[] bytes = readAll(uri);
				String name = knownName != null ? knownName : displayName(uri);
				String js = "window.JavaPlayApp&&JavaPlayApp.openJarBase64(" + JSONObject.quote(name) + ",'"
						+ Base64.encodeToString(bytes, Base64.NO_WRAP) + "'," + start + ")";
				runOnUiThread(() -> {
					if (pageReady) web.evaluateJavascript(js, null);
					else pendingJarJs = js;
				});
			} catch (IOException | SecurityException e) {
				runOnUiThread(() -> Toast.makeText(this, "Could not open the file", Toast.LENGTH_LONG).show());
			}
		}).start();
	}

	private byte[] readAll(Uri uri) throws IOException {
		try (InputStream in = getContentResolver().openInputStream(uri)) {
			if (in == null) throw new IOException("no stream");
			ByteArrayOutputStream out = new ByteArrayOutputStream();
			byte[] buf = new byte[16384];
			int n;
			while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
			return out.toByteArray();
		}
	}

	private String displayName(Uri uri) {
		String name = null;
		try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
			if (c != null && c.moveToFirst()) name = c.getString(0);
		} catch (Exception ignored) {
		}
		if (name == null) name = uri.getLastPathSegment();
		return name == null ? "game.jar" : name;
	}

	@Override
	public void onBackPressed() {
		web.evaluateJavascript("window.JavaPlayApp?JavaPlayApp.back():false", v -> {
			if (!"true".equals(v)) finish();
		});
	}

	@Override
	protected void onPause() {
		super.onPause();
		web.onPause();
	}

	@Override
	protected void onResume() {
		super.onResume();
		web.onResume();
		Object[] j;
		while ((j = jarQueue.poll()) != null) importJar((Uri) j[0], (String) j[1], (Boolean) j[2]);
	}

	// ---------------- version / updates ----------------
	// Updates are downloaded from the website in the phone's browser; the app only knows its own version.

	@SuppressWarnings("deprecation")
	private int currentVersionCode() {
		try {
			return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
		} catch (Exception e) {
			return 0;
		}
	}

	private void openExternal(String url) {
		if (url == null || !url.startsWith("https://")) return;
		try {
			startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
		} catch (ActivityNotFoundException e) {
			Toast.makeText(this, "No browser found", Toast.LENGTH_LONG).show();
		}
	}

	@Override
	protected void onActivityResult(int requestCode, int resultCode, Intent data) {
		if (requestCode != PICK_FILES || fileCallback == null) {
			super.onActivityResult(requestCode, resultCode, data);
			return;
		}
		Uri[] result = null;
		if (resultCode == RESULT_OK && data != null) {
			if (data.getClipData() != null) {
				int n = data.getClipData().getItemCount();
				result = new Uri[n];
				for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
			} else if (data.getData() != null) {
				result = new Uri[]{data.getData()};
			}
		}
		fileCallback.onReceiveValue(result);
		fileCallback = null;
	}

	@Override
	public void onWindowFocusChanged(boolean hasFocus) {
		super.onWindowFocusChanged(hasFocus);
		if (hasFocus && gameMode) hideSystemBars(true);
	}

	private void hideSystemBars(boolean on) {
		View d = getWindow().getDecorView();
		Window w = getWindow();
		if (on) {
			w.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
			d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
					| View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
					| View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
		} else {
			w.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
			d.setSystemUiVisibility(0);
		}
		// re-measure right away so the page does not keep the full-screen insets (gap above the home screen)
		if (Build.VERSION.SDK_INT >= 20) d.requestApplyInsets();
		web.requestLayout();
	}

	private class Client extends WebViewClient {
		@Override
		public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
			Uri u = request.getUrl();
			if (!"keyplay.app".equals(u.getHost())) return null;
			String path = u.getPath();
			if (path == null || path.equals("/")) path = "/play.html";
			try {
				InputStream in = getAssets().open("web" + path);
				String ext = MimeTypeMap.getFileExtensionFromUrl(path);
				String mime = "js".equals(ext) ? "text/javascript"
						: "css".equals(ext) ? "text/css"
						: "html".equals(ext) ? "text/html"
						: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
				return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "utf-8", in);
			} catch (IOException e) {
				return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
			}
		}

		@Override
		public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
			Uri u = request.getUrl();
			if ("keyplay.app".equals(u.getHost())) return false;
			try {
				startActivity(new Intent(Intent.ACTION_VIEW, u));
			} catch (ActivityNotFoundException ignored) {
			}
			return true;
		}

		@Override
		public void onPageFinished(WebView view, String url) {
			pageReady = true;
			if (pendingJarJs != null) {
				view.evaluateJavascript(pendingJarJs, null);
				pendingJarJs = null;
			}
		}
	}

	private class Chrome extends WebChromeClient {
		@Override
		public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
			if (fileCallback != null) fileCallback.onReceiveValue(null);
			fileCallback = callback;
			Intent i = new Intent(Intent.ACTION_GET_CONTENT);
			i.addCategory(Intent.CATEGORY_OPENABLE);
			i.setType("*/*");
			i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
			try {
				startActivityForResult(Intent.createChooser(i, "Choose a .jar game"), PICK_FILES);
			} catch (ActivityNotFoundException e) {
				fileCallback = null;
				return false;
			}
			return true;
		}
	}

	/** Called from JavaScript as window.JavaPlayAndroid. */
	private class Bridge {
		@JavascriptInterface
		public int versionCode() {
			return currentVersionCode();
		}

		@JavascriptInterface
		public String versionName() {
			try {
				return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
			} catch (Exception e) {
				return "";
			}
		}

		/** Opens the in-app browser for finding more .jar games on the web. */
		@JavascriptInterface
		public void openBrowser(String url) {
			runOnUiThread(() -> {
				Intent i = new Intent(MainActivity.this, BrowserActivity.class);
				if (url != null && url.startsWith("https://")) i.putExtra(BrowserActivity.EXTRA_URL, url);
				startActivity(i);
			});
		}

		/** Opens a link in the phone's browser (update downloads, website pages). */
		@JavascriptInterface
		public void openExternal(String url) {
			runOnUiThread(() -> MainActivity.this.openExternal(url));
		}

		@JavascriptInterface
		public void vibrate(int ms) {
			Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
			if (v == null || ms <= 0) return;
			if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(Math.min(ms, 2000), VibrationEffect.DEFAULT_AMPLITUDE));
			else v.vibrate(Math.min(ms, 2000));
		}

		@JavascriptInterface
		public void setOrientation(String mode) {
			runOnUiThread(() -> {
				// "sensor" turns with the phone; "landscape" allows either landscape side
				if ("sensor".equals(mode)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
				else if ("landscape".equals(mode)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
				else if ("portrait".equals(mode)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
				else setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
			});
		}

		/** Game screen: hide status + navigation bars (swipe from the edge shows them briefly). */
		@JavascriptInterface
		public void setFullscreen(boolean on) {
			runOnUiThread(() -> {
				gameMode = on;
				hideSystemBars(on);
			});
		}

		@JavascriptInterface
		public void saveFile(String name, String base64, String mime) {
			byte[] data = Base64.decode(base64, Base64.DEFAULT);
			try {
				if (Build.VERSION.SDK_INT >= 29) {
					ContentValues cv = new ContentValues();
					cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
					cv.put(MediaStore.MediaColumns.MIME_TYPE, mime == null || mime.isEmpty() ? "video/webm" : mime.split(";")[0]);
					cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/JavaPlay");
					Uri uri = getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, cv);
					if (uri == null) throw new IOException("insert failed");
					try (OutputStream out = getContentResolver().openOutputStream(uri)) {
						if (out == null) throw new IOException("no output");
						out.write(data);
					}
				} else {
					File dir = new File(getExternalFilesDir(Environment.DIRECTORY_MOVIES), "JavaPlay");
					if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir failed");
					try (FileOutputStream out = new FileOutputStream(new File(dir, name))) {
						out.write(data);
					}
				}
				runOnUiThread(() -> web.evaluateJavascript("window.JavaPlayApp&&JavaPlayApp.videoSaved(true)", null));
			} catch (IOException e) {
				runOnUiThread(() -> web.evaluateJavascript("window.JavaPlayApp&&JavaPlayApp.videoSaved(false)", null));
			}
		}
	}
}
