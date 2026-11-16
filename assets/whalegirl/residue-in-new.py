                elif _composer_text(info["value"]).strip() == str(text or "").strip():
                    # WHALE-RESIDUE-CLEAN（W5b）：框里正好是本条要发的正文，说明上一轮
                    # 「点了发送但没生效」把正文留成了草稿，不是用户手打的。清掉继续发；
                    # 不认这种情况的话，该会话以后每条都报 input_not_empty，永久堵死。
                    if _clear_composer(hwnd, info.get("edit")):
                        log("后台通道：输入框残留的就是本条正文（上次发送没生效），已清框，继续发")
                        info = read_ui(hwnd)
                        if info["edit"] is None:
                            return False, "no_input_field"
                        if info["send_xy"] is None:
                            return False, "no_send_button"
                    else:
                        log("后台通道：残留正文清不掉，本条不发（避免把残留拼进正文）")
                        return False, "input_dirty"
                else:
                    return False, "input_not_empty"
