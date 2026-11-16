                if _is_blank(v):
                    return True, partial
                time.sleep(TIMING["verifyPoll"])
            return False, "residue_left"
