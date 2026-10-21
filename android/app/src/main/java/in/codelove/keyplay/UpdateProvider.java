package in.codelove.keyplay;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Serves the one downloaded update APK (content://in.codelove.keyplay.update/JavaPlay.apk) to the package installer. */
public class UpdateProvider extends ContentProvider {
	static final String AUTHORITY = "in.codelove.keyplay.update";
	static final String NAME = "JavaPlay.apk";
	static final String MIME = "application/vnd.android.package-archive";

	static File apkFile(android.content.Context c) {
		return new File(c.getCacheDir(), "update/" + NAME);
	}

	static Uri apkUri() {
		return Uri.parse("content://" + AUTHORITY + "/" + NAME);
	}

	@Override
	public boolean onCreate() {
		return true;
	}

	@Override
	public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
		if (!NAME.equals(uri.getLastPathSegment())) throw new FileNotFoundException(uri.toString());
		return ParcelFileDescriptor.open(apkFile(getContext()), ParcelFileDescriptor.MODE_READ_ONLY);
	}

	@Override
	public String getType(Uri uri) {
		return MIME;
	}

	@Override
	public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
		File f = apkFile(getContext());
		MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
		c.addRow(new Object[]{NAME, f.length()});
		return c;
	}

	@Override
	public Uri insert(Uri uri, ContentValues values) {
		return null;
	}

	@Override
	public int delete(Uri uri, String selection, String[] selectionArgs) {
		return 0;
	}

	@Override
	public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
		return 0;
	}
}
