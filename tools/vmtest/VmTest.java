import java.io.*;
import java.util.*;

public class VmTest {
    static int counter;
    static final String CONST = "const";
    static int[] table = new int[5];
    static { for (int i = 0; i < table.length; i++) table[i] = i * i; }

    interface Shape { int area(); }
    static abstract class Base implements Shape {
        protected int w, h;
        Base(int w, int h) { this.w = w; this.h = h; }
        public String toString() { return getClass().getName() + "[" + w + "x" + h + "=" + area() + "]"; }
    }
    static class Rect extends Base { Rect(int w, int h) { super(w, h); } public int area() { return w * h; } }
    static class Tri extends Base { Tri(int w, int h) { super(w, h); } public int area() { return w * h / 2; } }
    static class MyEx extends Exception { int code; MyEx(String m, int c) { super(m); code = c; } }

    static int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

    static int sw(int x) {
        switch (x) { case 1: return 10; case 2: return 20; case 5: return 50; case 100: return 1000; default: return -1; }
    }
    static int sw2(int x) {
        switch (x) { case 0: return 7; case 1: return 8; case 2: return 9; case 3: return 10; default: return 0; }
    }

    static String tryFinally(int n) {
        StringBuffer sb = new StringBuffer();
        try {
            sb.append("try");
            if (n == 1) throw new IllegalStateException("x");
            if (n == 2) return sb.append("-ret").toString();
        } catch (IllegalStateException e) {
            sb.append("-catch:").append(e.getMessage());
        } finally {
            sb.append("-finally");
        }
        return sb.toString();
    }

    static final Object lock = new Object();
    static int produced = 0;
    static Vector queue = new Vector();

    public static void main(String[] args) throws Exception {
        // ints
        int a = 2147483647, b = -2147483648;
        System.out.println((a + 1) + " " + (b - 1) + " " + (a * 3) + " " + (b / -1) + " " + (-7 / 2) + " " + (-7 % 2) + " " + (7 % -3));
        System.out.println((1 << 33) + " " + (-16 >> 2) + " " + (-16 >>> 28) + " " + (0x7f & 0x3c | 1 ^ 3));
        byte by = (byte) 200; short sh = (short) 70000; char ch = (char) -1;
        System.out.println(by + " " + sh + " " + (int) ch + " " + (int) 'A' + " " + (char) 66);
        // longs
        long L = 9223372036854775807L;
        System.out.println((L + 1) + " " + (L * 2) + " " + (L / 3) + " " + (-L % 7) + " " + (1L << 40) + " " + (-1L >>> 60) + " " + (-1L >> 60));
        long t = 123456789012345L;
        System.out.println((int) t + " " + (t ^ 0xFFFFL) + " " + Long.toString(t, 16) + " " + (t > 100 ? "gt" : "le"));
        // floats & doubles
        float f = 1.1f; double d = 1.1;
        System.out.println(f + " " + d + " " + (f * 3) + " " + (d * 3) + " " + (1.0f / 3) + " " + (2.0 / 3) + " " + (float) 1e10 + " " + 1e-5 + " " + 100.0 + " " + 0.001);
        System.out.println((int) 3.99 + " " + (int) -3.99 + " " + (int) Float.NaN + " " + (long) 1e30 + " " + (int) 1e30f + " " + Math.round(2.5f) + " " + Math.round(-2.5));
        System.out.println(Float.floatToIntBits(1.5f) + " " + Double.doubleToLongBits(-2.25) + " " + Float.intBitsToFloat(0x40490fdb));
        System.out.println(Math.sqrt(2) + " " + Math.abs(-5) + " " + Math.max(3L, 9L) + " " + Math.min(-1.5f, 2f));
        // strings
        String s = "Hello, World";
        System.out.println(s.length() + " " + s.charAt(4) + " " + s.substring(7) + " " + s.indexOf('o') + " " + s.lastIndexOf("o") + " " + s.toUpperCase() + " " + s.hashCode());
        System.out.println("  trim  ".trim() + "|" + s.replace('l', 'L') + "|" + s.startsWith("Hell") + s.endsWith("x") + "|" + "abc".compareTo("abd") + "|" + s.equals("Hello, World") + "|" + CONST);
        String n = null;
        System.out.println("null concat: " + n + " " + 'c' + 1 + 2L + 3.0f + true);
        char[] cs = { 'x', 'y', 'z' };
        System.out.println(new String(cs) + new String(cs, 1, 2) + String.valueOf(42) + Integer.parseInt("-123") + Integer.toHexString(-1) + Integer.toBinaryString(10));
        StringBuffer sb = new StringBuffer("abc");
        sb.append(1).append('-').append(2.5).insert(0, "<").reverse();
        System.out.println(sb.toString() + " " + sb.length());
        try { Integer.parseInt("12x"); } catch (NumberFormatException e) { System.out.println("NFE ok"); }
        byte[] utf = "héllo".getBytes("UTF-8");
        System.out.println(utf.length + " " + new String(utf, "UTF-8"));
        // arrays
        int[][] grid = new int[3][4];
        grid[2][3] = 9;
        long[] la = new long[3]; la[1] = 5L;
        Object[] oa = new String[2];
        System.out.println(grid.length + " " + grid[2].length + " " + grid[2][3] + " " + la[1] + " " + (oa instanceof String[]) + " " + table[4]);
        int[] src = { 1, 2, 3, 4, 5 };
        System.arraycopy(src, 0, src, 1, 4);
        System.out.println(src[0] + "" + src[1] + src[2] + src[3] + src[4]);
        try { int x = src[10]; } catch (ArrayIndexOutOfBoundsException e) { System.out.println("AIOOBE ok"); }
        try { Object o = null; o.toString(); } catch (NullPointerException e) { System.out.println("NPE ok"); }
        try { int z = 0; int y = 5 / z; } catch (ArithmeticException e) { System.out.println("AE " + e.getMessage()); }
        try { Object o = "s"; Integer i = (Integer) o; } catch (ClassCastException e) { System.out.println("CCE ok"); }
        // objects
        Shape[] shapes = { new Rect(3, 4), new Tri(6, 5) };
        for (int i = 0; i < shapes.length; i++) System.out.println(shapes[i] + " " + (shapes[i] instanceof Rect) + " " + (shapes[i] instanceof Shape));
        try { throw new MyEx("boom", 7); } catch (MyEx e) { System.out.println("MyEx " + e.getMessage() + " " + e.code + " " + e); }
        System.out.println(tryFinally(0) + " " + tryFinally(1) + " " + tryFinally(2));
        System.out.println(fib(20) + " " + sw(5) + sw(100) + sw(3) + " " + sw2(2) + sw2(9));
        // collections
        Vector v = new Vector();
        for (int i = 0; i < 5; i++) v.addElement(new Integer(i * 10));
        v.removeElementAt(1); v.insertElementAt("s", 0);
        System.out.println(v.size() + " " + v.elementAt(0) + " " + v.indexOf(new Integer(30)) + " " + v.contains(new Integer(40)) + " " + v);
        Hashtable h = new Hashtable();
        h.put("a", new Integer(1)); h.put(new Integer(5), "five"); h.put("a", new Integer(2));
        System.out.println(h.size() + " " + h.get("a") + " " + h.get(new Integer(5)) + " " + h.containsKey("zz"));
        Random r = new Random(42);
        System.out.println(r.nextInt() + " " + r.nextInt(100) + " " + r.nextLong() + " " + r.nextInt(64) + " " + r.nextFloat() + " " + r.nextDouble());
        // streams
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        DataOutputStream dos = new DataOutputStream(bos);
        dos.writeInt(-5); dos.writeShort(1234); dos.writeUTF("Tamil வணக்கம்"); dos.writeLong(-99L); dos.writeBoolean(true); dos.writeFloat(3.25f);
        byte[] bytes = bos.toByteArray();
        DataInputStream dis = new DataInputStream(new ByteArrayInputStream(bytes));
        System.out.println(bytes.length + " " + dis.readInt() + " " + dis.readShort() + " " + dis.readUTF() + " " + dis.readLong() + " " + dis.readBoolean() + " " + dis.readFloat() + " " + dis.read());
        // threads
        Thread producer = new Thread(new Runnable() {
            public void run() {
                for (int i = 0; i < 5; i++) {
                    synchronized (lock) { queue.addElement(new Integer(i)); produced++; lock.notifyAll(); }
                    try { Thread.sleep(5); } catch (InterruptedException e) { }
                }
            }
        });
        producer.start();
        int got = 0, sum = 0;
        synchronized (lock) {
            while (got < 5) {
                while (queue.isEmpty()) lock.wait();
                sum += ((Integer) queue.elementAt(0)).intValue();
                queue.removeElementAt(0);
                got++;
            }
        }
        producer.join();
        System.out.println("threads done sum=" + sum + " produced=" + produced + " alive=" + producer.isAlive());
        final int[] shared = new int[1];
        Thread[] ws = new Thread[3];
        for (int i = 0; i < 3; i++) {
            ws[i] = new Thread() { public void run() { for (int k = 0; k < 1000; k++) synchronized (lock) { shared[0]++; } } };
            ws[i].start();
        }
        for (int i = 0; i < 3; i++) ws[i].join();
        System.out.println("shared=" + shared[0]);
        // getResourceAsStream-free; class names
        System.out.println(new Rect(1, 1).getClass().getName() + " " + "x".getClass().getName());
        System.out.println("END");
    }
}
