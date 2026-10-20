import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.File;

import javax.imageio.ImageIO;

/**
 * JavaPlay mark: an orange tile with a dark game screen (play triangle) and three keypad dots.
 * Same geometry as web/assets/favicon.svg, so the app icon, logo and favicons match.
 * Usage: AppIcon <resDir> <webAssetsDir>
 */
public class AppIcon {
	private static final String[] DENSITIES = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
	private static final float[] SCALE = {1f, 1.5f, 2f, 3f, 4f};
	static final Color TOP = new Color(0xFFA23D), BOTTOM = new Color(0xFF6A00);
	static final Color INK = new Color(0x14161C), PLAY = new Color(0xFF8A1F);

	public static void main(String[] args) throws Exception {
		File res = new File(args[0]);
		File web = new File(args[1]);
		for (int i = 0; i < DENSITIES.length; i++) {
			File dir = new File(res, "mipmap-" + DENSITIES[i]);
			ImageIO.write(render(Math.round(48 * SCALE[i]), true, 1f), "png", new File(dir, "ic_launcher.png"));
			// adaptive foreground: artwork shrunk into the 66/108 safe zone; the tile comes from the background drawable
			ImageIO.write(render(Math.round(108 * SCALE[i]), false, 0.66f), "png", new File(dir, "ic_launcher_foreground.png"));
		}
		ImageIO.write(render(512, true, 1f), "png", new File(web, "javaplay-logo.png"));
		ImageIO.write(render(192, true, 1f), "png", new File(web, "icon-192.png"));
		ImageIO.write(render(32, true, 1f), "png", new File(web, "favicon-32.png"));
		// iOS masks its own corners, so the touch icon is a full square
		ImageIO.write(render(180, true, 1f, 0f), "png", new File(web, "apple-touch-icon.png"));
	}

	static BufferedImage render(int s, boolean tile, float art) {
		return render(s, tile, art, 0.22f);
	}

	/** Draws in a 0..1 unit square; art scales the screen + dots about the center. */
	static BufferedImage render(int s, boolean tile, float art, float radius) {
		BufferedImage img = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
		Graphics2D g = img.createGraphics();
		g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
		g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
		if (tile) {
			g.setPaint(new GradientPaint(0, 0, TOP, 0, s, BOTTOM));
			float r = s * radius * 2;
			g.fill(new RoundRectangle2D.Float(0, 0, s, s, r, r));
		}
		g.translate(s / 2.0, s / 2.0);
		g.scale(s * art, s * art);
		g.translate(-0.5, -0.5);
		// screen
		g.setColor(INK);
		g.fill(new RoundRectangle2D.Float(0.18f, 0.16f, 0.64f, 0.46f, 0.14f, 0.14f));
		// play triangle
		Path2D.Float p = new Path2D.Float();
		p.moveTo(0.43, 0.27);
		p.lineTo(0.43, 0.51);
		p.lineTo(0.63, 0.39);
		p.closePath();
		g.setColor(PLAY);
		g.fill(p);
		// keypad dots
		g.setColor(INK);
		for (int k = 0; k < 3; k++) {
			float cx = 0.30f + k * 0.20f;
			g.fill(new Ellipse2D.Float(cx - 0.065f, 0.755f - 0.065f, 0.13f, 0.13f));
		}
		g.dispose();
		return img;
	}
}
