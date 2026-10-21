package in.codelove.keyplay;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Small in-app browser for finding more Java games on the web (PHONEKY and others).
 * A .jar download is saved by the system download manager to Downloads/JavaPlay, then the game
 * is handed to MainActivity (play now, or add to My games and keep browsing).
 */
public class BrowserActivity extends Activity {
	static final String EXTRA_URL = "url";
	private static final int ASK_STORAGE = 2;

	private WebView web;
	private EditText address;
	private ProgressBar progress;
	private DownloadManager dm;
	private final java.util.Map<Long, String> downloads = new java.util.HashMap<>(); // id -> file name
	private String[] pending; // download waiting for the storage permission (Android 6 to 9)

	@SuppressLint("SetJavaScriptEnabled")
	@Override
	protected void onCreate(Bundle savedInstanceState) {
		setTheme(R.style.JavaPlayTheme_Main);
		super.onCreate(savedInstanceState);
		if (Build.VERSION.SDK_INT >= 21) {
			getWindow().setStatusBarColor(Color.parseColor("#171A21"));
			getWindow().setNavigationBarColor(Color.parseColor("#0E1014"));
		}
		dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);

		LinearLayout root = new LinearLayout(this);
		root.setOrientation(LinearLayout.VERTICAL);
		root.setBackgroundColor(Color.parseColor("#0E1014"));

		LinearLayout bar = new LinearLayout(this);
		bar.setOrientation(LinearLayout.HORIZONTAL);
		bar.setGravity(Gravity.CENTER_VERTICAL);
		bar.setBackgroundColor(Color.parseColor("#171A21"));
		bar.setPadding(dp(4), dp(6), dp(4), dp(6));
		bar.addView(barButton("✕", "Close", v -> finish()));
		address = new EditText(this);
		address.setSingleLine(true);
		address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
		address.setImeOptions(EditorInfo.IME_ACTION_GO);
		address.setTextColor(Color.parseColor("#EEF0F4"));
		address.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
		address.setSelectAllOnFocus(true);
		address.setBackgroundColor(Color.parseColor("#262A34"));
		address.setPadding(dp(14), dp(8), dp(14), dp(8));
		address.setOnEditorActionListener((v, actionId, event) -> {
			boolean enter = event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER;
			if (actionId != EditorInfo.IME_ACTION_GO && !enter) return false;
			if (enter && event.getAction() != KeyEvent.ACTION_DOWN) return true; // Enter fires down + up: go once
			go(address.getText().toString());
			return true;
		});
		bar.addView(address, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
		bar.addView(barButton("⟳", "Reload", v -> web.reload()));
		root.addView(bar);

		progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
		progress.setMax(100);
		root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

		web = new WebView(this);
		WebSettings s = web.getSettings();
		s.setJavaScriptEnabled(true);
		s.setDomStorageEnabled(true);
		s.setLoadWithOverviewMode(true);
		s.setUseWideViewPort(true);
		s.setSupportMultipleWindows(false);
		s.setAllowFileAccess(false);
		CookieManager.getInstance().setAcceptCookie(true);
		web.setWebViewClient(new Client());
		web.setWebChromeClient(new android.webkit.WebChromeClient() {
			@Override
			public void onProgressChanged(WebView view, int p) {
				progress.setProgress(p);
				progress.setVisibility(p >= 100 ? View.INVISIBLE : View.VISIBLE);
			}
		});
		web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
				startDownload(url, userAgent, contentDisposition, mimeType));
		root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
		setContentView(root);

		IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
		if (Build.VERSION.SDK_INT >= 33) registerReceiver(done, f, Context.RECEIVER_EXPORTED);
		else registerReceiver(done, f);

		String url = getIntent().getStringExtra(EXTRA_URL);
		go(url == null ? "https://phoneky.com/games/" : url);
	}

	@Override
	protected void onDestroy() {
		try {
			unregisterReceiver(done);
		} catch (IllegalArgumentException ignored) {
		}
		web.destroy();
		super.onDestroy();
	}

	@Override
	public void onBackPressed() {
		if (web.canGoBack()) web.goBack();
		else finish();
	}

	private void go(String text) {
		String t = text.trim();
		if (t.isEmpty()) return;
		String url = t.contains("://") ? t
				: t.contains(".") && !t.contains(" ") ? "https://" + t
				: "https://www.google.com/search?q=" + Uri.encode(t + " java game jar");
		web.loadUrl(url);
		InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
		if (imm != null) imm.hideSoftInputFromWindow(address.getWindowToken(), 0);
		web.requestFocus();
	}

	private TextView barButton(String label, String description, View.OnClickListener l) {
		TextView b = new TextView(this);
		b.setText(label);
		b.setContentDescription(description);
		b.setTextColor(Color.parseColor("#EEF0F4"));
		b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
		b.setTypeface(Typeface.DEFAULT_BOLD);
		b.setGravity(Gravity.CENTER);
		b.setLayoutParams(new LinearLayout.LayoutParams(dp(44), dp(44)));
		b.setOnClickListener(l);
		return b;
	}

	private int dp(int v) {
		return Math.round(v * getResources().getDisplayMetrics().density);
	}

	// ---------------- downloads ----------------

	private void startDownload(String url, String userAgent, String contentDisposition, String mimeType) {
		String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
		String lower = name.toLowerCase();
		boolean javaMime = mimeType != null && mimeType.contains("java");
		if (lower.endsWith(".jad")) {
			Toast.makeText(this, "That is a .jad file. Pick the .jar download, it has the game.", Toast.LENGTH_LONG).show();
			return;
		}
		if (!lower.endsWith(".jar")) {
			if (!javaMime) {
				Toast.makeText(this, "Only .jar Java games can be downloaded here.", Toast.LENGTH_LONG).show();
				return;
			}
			name = name.replaceAll("\\.[A-Za-z0-9]{1,4}$", "") + ".jar";
		}
		String[] req = {url, userAgent, name};
		if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT <= 28
				&& checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
			pending = req;
			requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, ASK_STORAGE);
			return;
		}
		enqueue(req, true);
	}

	@Override
	public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
		if (requestCode != ASK_STORAGE || pending == null) return;
		boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
		enqueue(pending, granted);
		pending = null;
	}

	/** publicFolder: Downloads/JavaPlay (seen in the file manager); otherwise the app's own folder. */
	private void enqueue(String[] req, boolean publicFolder) {
		try {
			DownloadManager.Request r = new DownloadManager.Request(Uri.parse(req[0]));
			String cookies = CookieManager.getInstance().getCookie(req[0]);
			if (cookies != null) r.addRequestHeader("Cookie", cookies);
			if (req[1] != null) r.addRequestHeader("User-Agent", req[1]);
			r.setTitle(req[2]);
			r.setDescription("JavaPlay game download");
			r.setMimeType("application/java-archive");
			r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
			if (publicFolder) r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "JavaPlay/" + req[2]);
			else r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, req[2]);
			downloads.put(dm.enqueue(r), req[2]);
			Toast.makeText(this, "Downloading " + req[2] + "…", Toast.LENGTH_SHORT).show();
		} catch (Exception e) {
			Toast.makeText(this, "Could not download: " + e.getMessage(), Toast.LENGTH_LONG).show();
		}
	}

	private final BroadcastReceiver done = new BroadcastReceiver() {
		@Override
		public void onReceive(Context context, Intent intent) {
			long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
			String name = downloads.remove(id);
			if (name == null) return;
			boolean ok = false;
			try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
				if (c != null && c.moveToFirst()) {
					ok = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL;
				}
			}
			Uri uri = ok ? dm.getUriForDownloadedFile(id) : null;
			if (uri == null) {
				Toast.makeText(BrowserActivity.this, "Download failed. Try again.", Toast.LENGTH_LONG).show();
				return;
			}
			askWhatNext(uri, name);
		}
	};

	// the game always goes to My games; the dialog only decides whether to play it right away
	private void askWhatNext(Uri uri, String name) {
		if (isFinishing()) {
			MainActivity.queueJar(uri, name, false);
			return;
		}
		new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
				.setTitle("Game downloaded")
				.setMessage(name + " is saved in Downloads/JavaPlay and added to My games.")
				.setCancelable(false)
				.setPositiveButton("Play now", (d, w) -> {
					MainActivity.queueJar(uri, name, true);
					finish();
				})
				.setNegativeButton("Keep browsing", (d, w) -> MainActivity.queueJar(uri, name, false))
				.show();
	}

	private class Client extends WebViewClient {
		@Override
		public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
			Uri u = request.getUrl();
			String scheme = u.getScheme();
			if ("http".equals(scheme) || "https".equals(scheme)) return false;
			try {
				startActivity(new Intent(Intent.ACTION_VIEW, u)); // market:, intent:, mailto: …
			} catch (ActivityNotFoundException ignored) {
			}
			return true;
		}

		// never load a page whose certificate fails; offer the phone's browser instead of a blank page
		@Override
		public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
			handler.cancel();
			String url = error.getUrl();
			if (url == null || isFinishing()) return;
			if (!url.equals(view.getUrl()) && !url.equals(address.getText().toString())) return; // only for the page itself
			new AlertDialog.Builder(BrowserActivity.this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
					.setTitle("Secure connection failed")
					.setMessage("This phone cannot check this site's security certificate. Open it in your browser instead? Downloaded .jar files can be opened with JavaPlay from there.")
					.setPositiveButton("Open in browser", (d, w) -> {
						try {
							startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
						} catch (ActivityNotFoundException ignored) {
						}
					})
					.setNegativeButton("Cancel", null)
					.show();
		}

		@Override
		public void onPageStarted(WebView view, String url, Bitmap favicon) {
			if (!address.hasFocus()) address.setText(url);
		}

		@Override
		public void onPageFinished(WebView view, String url) {
			if (!address.hasFocus()) address.setText(url);
		}
	}
}
