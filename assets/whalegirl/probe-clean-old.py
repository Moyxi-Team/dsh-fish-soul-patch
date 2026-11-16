            if info["value"] is not None and not _is_blank(info["value"]):
                if _composer_text(info["value"]) in _PROBE_TEXTS:
                    log("后台通道：输入框里是编码探测留下的「鲸」，删掉后再发（不是用户草稿）")
                return False, "input_not_empty"
