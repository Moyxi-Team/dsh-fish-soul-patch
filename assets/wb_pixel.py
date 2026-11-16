# -*- coding: utf-8 -*-
"""WHALE-UI-CLIP 在微信窗口里找图片气泡：PrintWindow 抓窗口位图（不受遮挡）→ 像素块检测。"""
import collections


def _grab_imagegrab(win_rect):
    from PIL import ImageGrab
    return ImageGrab.grab(bbox=win_rect, all_screens=True).convert('RGB')


def _grab_printwindow(hwnd, win_rect):
    """PW_RENDERFULLCONTENT 抓窗口内容：微信被别的窗口盖住时也能拿到自己的画面，且不抢焦点。"""
    try:
        import ctypes
        import ctypes.wintypes as wt
        from PIL import Image
        u = ctypes.windll.user32
        gdi = ctypes.windll.gdi32
        l, t, r, b = win_rect
        w, h = r - l, b - t
        if w <= 0 or h <= 0:
            return None
        hdc = u.GetWindowDC(hwnd)
        if not hdc:
            return None
        mdc = gdi.CreateCompatibleDC(hdc)
        bmp = gdi.CreateCompatibleBitmap(hdc, w, h)
        try:
            gdi.SelectObject(mdc, bmp)
            if not u.PrintWindow(hwnd, mdc, 2):
                return None

            class BMI(ctypes.Structure):
                _fields_ = [('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG),
                            ('biPlanes', wt.WORD), ('biBitCount', wt.WORD), ('biCompression', wt.DWORD),
                            ('biSizeImage', wt.DWORD), ('biXPelsPerMeter', wt.LONG),
                            ('biYPelsPerMeter', wt.LONG), ('biClrUsed', wt.DWORD),
                            ('biClrImportant', wt.DWORD)]

            bi = BMI()
            bi.biSize = ctypes.sizeof(BMI)
            bi.biWidth = w
            bi.biHeight = -h
            bi.biPlanes = 1
            bi.biBitCount = 32
            buf = ctypes.create_string_buffer(w * h * 4)
            if not gdi.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(bi), 0):
                return None
            img = Image.frombuffer('RGBA', (w, h), buf, 'raw', 'BGRA', 0, 1).convert('RGB')
        finally:
            gdi.DeleteObject(bmp)
            gdi.DeleteDC(mdc)
            u.ReleaseDC(hwnd, hdc)
        # 全黑说明这个窗口抓不出来（DWM 不给内容），交给 ImageGrab
        px = img.load()
        tot = nz = 0
        for y in range(0, h, 11):
            for x in range(0, w, 11):
                tot += 1
                if px[x, y] != (0, 0, 0):
                    nz += 1
        if tot and nz / float(tot) < 0.05:
            return None
        return img
    except Exception:
        return None


def _grab(hwnd, win_rect):
    if hwnd:
        img = _grab_printwindow(hwnd, win_rect)
        if img is not None:
            return img
    return _grab_imagegrab(win_rect)


def find_image_box(win_rect, scale=4, save_png=None, hwnd=None):
    """返回窗口坐标系下的图片气泡矩形 (l, t, r, b)，找不到返回 None。

    判定：与聊天区背景色的块状差异区域，尺寸像一张图（>=100x100），
    不在左侧会话列表里，也不是顶部标题栏/底部输入框；取最靠下的那一个（最新消息）。
    """
    img = _grab(hwnd, win_rect)
    W, H = img.size
    if save_png:
        try:
            img.save(save_png)
        except Exception:
            pass
    S = max(2, int(scale))
    small = img.resize((max(1, W // S), max(1, H // S)), 1)
    sw, sh = small.size
    px = small.load()

    cnt = collections.Counter()
    for y in range(int(sh * 0.15), int(sh * 0.92), 3):
        for x in range(int(sw * 0.35), sw - 2, 3):
            cnt[px[x, y]] += 1
    if not cnt:
        return None
    bg = cnt.most_common(1)[0][0]

    def fg(p):
        return abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > 40

    mask = [bytearray(sw) for _ in range(sh)]
    for y in range(sh):
        row = mask[y]
        for x in range(sw):
            if fg(px[x, y]):
                row[x] = 1

    seen = [bytearray(sw) for _ in range(sh)]
    boxes = []
    for y in range(sh):
        for x in range(sw):
            if not mask[y][x] or seen[y][x]:
                continue
            stack = [(x, y)]
            seen[y][x] = 1
            n = 0
            l = r = x
            t = b = y
            while stack:
                cx, cy = stack.pop()
                n += 1
                if cx < l: l = cx
                if cx > r: r = cx
                if cy < t: t = cy
                if cy > b: b = cy
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < sw and 0 <= ny < sh and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = 1
                        stack.append((nx, ny))
            w = r - l + 1
            h = b - t + 1
            if w >= 25 and h >= 15 and n > 0.45 * w * h:
                boxes.append((n, l * S, t * S, (r + 1) * S, (b + 1) * S))

    best = None
    for (n, l, t, r, b) in boxes:
        w, h = r - l, b - t
        if w < 100 or h < 100:
            continue
        if w > 0.75 * W or h > 0.95 * H:
            continue
        if l < 0.20 * W or t < 0.06 * H:
            continue
        if b > 0.95 * H:
            continue
        if best is None or b > best[4]:
            best = (l, t, r, b)
    return best
