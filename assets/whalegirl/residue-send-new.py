                if _is_blank(v):
                    return True, partial
                time.sleep(TIMING["verifyPoll"])
            # WHALE-RESIDUE-CLEAN（W5）：点到发送按钮但输入框里还留着本条正文，
            # 多半是这次点击没生效。以前直接报 residue_left 就收工，正文留成草稿，
            # 下一次发送立刻 input_not_empty，这个会话从此永久发不出去
            # （群里表现就是「希希不理人」）。现在按框里的内容分流：
            #   · 框已空（UIA 慢一拍）  → 按已发送处理，不重发
            #   · 框里是别的字（用户打的）→ 不动，照旧报 residue_left
            #   · 框里就是本条正文       → 清干净后重打重发一次
            left = read_ui(hwnd)
            if not _target_composer(left, chat):
                return False, "residue_left"
            left_text = _composer_text(left.get("value"))
            if left_text == "":
                return True, partial
            if left_text != expected:
                return False, "residue_left"
            if not _clear_composer(hwnd, left.get("edit")):
                log("后台通道：点击发送后残留清不掉，本条不发（免得把残留拼进下一条）")
                return False, "residue_left"
            log("后台通道：点击发送没生效（正文还留在输入框），已清框，重发一次")
            for _ in range(1):
                cur = read_ui(hwnd)
                if not _target_composer(cur, chat) or not _is_blank(cur.get("value")):
                    break
                if cur.get("send_xy") is None:
                    break
                typed, _skipped2 = _type_text(sender, cur.get("edit"), text, mode=mode,
                                              char_gap=char_gap,
                                              strip_unencodable=strip_unencodable, log=log)
                if not typed:
                    sender.end_input()
                    break
                time.sleep(TIMING["sendEnabled"])
                _info2, observed2, _stable2 = _read_typed_composer(hwnd, chat, expected)
                if observed2 != expected:
                    sender.end_input()
                    break
                xy2 = read_ui(hwnd).get("send_xy")
                if xy2 is None:
                    sender.end_input()
                    break
                sender.click_screen(*xy2)
                time.sleep(TIMING["afterClick"])
                sender.end_input()
                deadline2 = time.time() + 2.0
                while time.time() < deadline2:
                    v2 = read_ui(hwnd).get("value")
                    if v2 is None or _is_blank(v2):
                        log("后台通道：残留清掉后重发成功（%s）" % partial)
                        return True, partial
                    time.sleep(TIMING["verifyPoll"])
            return False, "send_not_effective"
