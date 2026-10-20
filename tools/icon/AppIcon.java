import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;

import javax.imageio.ImageIO;

/**
 * KeyPlay launcher icon: a candybar handset (screen on top, D-pad + keys below).
 * Usage: AppIcon <resDir> <websiteLogo.png>
 */
public class AppIcon {
	private static final String[] DENSITIES = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
	private static final float[] SCALE = {1f, 1.5f, 2f, 3f, 4f};

	public static void main(String[] args) throws Exception {
		File res = new File(args[0]);
		for (int i = 0; i < DENSITIES.length; i++) {
			File dir = new File(res, "mipmap-" + DENSITIES[i]);
			int legacy = Math.round(48 * SCALE[i]);
			int fg = Math.round(108 * SCALE[i]);
			ImageIO.write(render(legacy, true, 0.80f), "png", new File(dir, "ic_launcher.png"));
			// adaptive foreground: artwork inside the 66/108 safe zone, transparent background
			ImageIO.write(render(fg, false, 0.56f), "png", new File(dir, "ic_launcher_foreground.png"));
		}
		ImageIO.write(render(512, true, 0.80f), "png", new File(args[1]));
	}

	static BufferedImage render(int s, boolean background, float phoneScale) {
		BufferedImage img = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = img.createGraphics();
		g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
		if (background) {
			g.setPaint(new GradientPaint(0, 0, new Color(0x232733), 0, s, new Color(0x0E1015)));
			g.fill(new RoundRectangle2D.Float(0, 0, s, s, s * 0.44f, s * 0.44f));
		}
		float ph = s * phoneScale;          // phone height
		float pw = ph * 0.56f;              // phone width
		float px = (s - pw) / 2f, py = (s - ph) / 2f;

		// body
		g.setColor(new Color(0x2E3340));
		g.fill(new RoundRectangle2D.Float(px, py, pw, ph, pw * 0.32f, pw * 0.32f));
		// screen
		float m = pw * 0.12f;
		float sw = pw - m * 2, sh = ph * 0.38f;
		g.setPaint(new GradientPaint(0, py + m, new Color(0xFFB066), 0, py + m + sh, new Color(0xFF6A00)));
		g.fill(new RoundRectangle2D.Float(px + m, py + m, sw, sh, pw * 0.12f, pw * 0.12f));
		// tiny "game" on the screen
		g.setColor(new Color(0x1A1206));
		float b = sw / 7f;
		for (int k = 0; k < 3; k++) {
			g.fill(new RoundRectangle2D.Float(px + m + b * (1 + k), py + m + sh * 0.62f, b * 0.86f, b * 0.86f, b * 0.4f, b * 0.4f));
		}
		g.fill(new Ellipse2D.Float(px + m + b * 5, py + m + sh * 0.28f, b * 0.86f, b * 0.86f));
		// d-pad
		float dpad = pw * 0.42f;
		float dy = py + m + sh + ph * 0.06f;
		float cx = px + pw / 2f;
		g.setColor(new Color(0x444A5A));
		g.fill(new Ellipse2D.Float(cx - dpad / 2, dy, dpad, dpad));
		g.setColor(new Color(0xFF8A1F));
		float ok = dpad * 0.42f;
		g.fill(new Ellipse2D.Float(cx - ok / 2, dy + (dpad - ok) / 2, ok, ok));
		// keys
		float ky = dy + dpad + ph * 0.05f;
		float kw = (pw - m * 2) / 3f;
		float kh = (py + ph - m * 0.9f - ky) / 2f;
		g.setColor(new Color(0x596074));
		for (int r = 0; r < 2; r++) {
			for (int c = 0; c < 3; c++) {
				float kx = px + m + c * kw;
				g.fill(new RoundRectangle2D.Float(kx + kw * 0.12f, ky + r * kh + kh * 0.14f, kw * 0.76f, kh * 0.72f, kh * 0.5f, kh * 0.5f));
			}
		}
		g.dispose();
		return img;
	}
}
