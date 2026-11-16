            if info["value"] is not None and not _is_blank(info["value"]):
                # WHALE-PROBE-CLEAN：探测残留「鲸」是可清理的脏框，不是用户草稿。
                # 以前这里只记日志就 return input_not_empty，等于把该会话永久堵死；
                # 现在先清一次，清干净就照常发，清不干净才拒发。
                if _composer_text(info["value"]) in _PROBE_TEXTS:
                    if _clear_composer(hwnd, info.get("edit")):
                        log("后台通道：已清掉编码探测残留的「鲸」，继续发送（不是用户草稿）")
                        info = read_ui(hwnd)
                        if info["edit"] is None:
                            return False, "no_input_field"
                        if info["send_xy"] is None:
                            return False, "no_send_button"
                    else:
                        log("后台通道：探测残留「鲸」清不掉，本条不发（避免把残留拼进正文）")
                        return False, "input_dirty"
                else:
                    return False, "input_not_empty"
