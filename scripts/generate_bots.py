import xml.etree.ElementTree as ET
import xml.dom.minidom as minidom
import os

def create_bot_xml(
    bot_name: str,
    over_prediction: int,
    under_prediction: int,
    over_entry_digits: list, # e.g. [0, 1, 2]
    under_entry_digits: list, # e.g. [7, 8, 9]
    default_stake: float = 0.35,
    default_target: float = 10.0,
    default_loss: float = 50.0,
    martingale_multiplier: float = 2.0,
    trades_per_cycle: int = 5
):
    """
    Generates a full Deriv DBot Blockly XML for Over/Under LDP trading.
    """
    id_counter = 0
    def gen_id(prefix="blk"):
        nonlocal id_counter
        id_counter += 1
        return f"{prefix}_{id_counter}_{abs(hash(bot_name)) % 10000}"

    root = ET.Element("xml", {
        "xmlns": "https://developers.google.com/blockly/xml",
        "is_dbot": "true",
        "collection": "false"
    })

    # Variables definition
    variables_data = [
        ("var_stake", "Stake"),
        ("var_init_stake", "InitialStake"),
        ("var_target", "TargetProfit"),
        ("var_loss", "StopLoss"),
        ("var_martingale", "MartingaleMultiplier"),
        ("var_prediction", "Prediction"),
        ("var_trade_dir", "TradeDirection"),
        ("var_pattern_found", "PatternFound"),
        ("var_trades_cycle", "TradesInCycle"),
        ("var_max_trades", "MaxTradesPerCycle"),
        ("var_tick_1", "Tick 1"),
        ("var_tick_2", "Tick 2"),
        ("var_tick_3", "Tick 3"),
        ("var_tick_4", "Tick 4"),
        ("var_text", "text"),
    ]

    var_elem = ET.SubElement(root, "variables")
    for var_id, var_name in variables_data:
        v = ET.SubElement(var_elem, "variable", {"id": var_id})
        v.text = var_name

    # Optional lock block (Profithub style, deletable=false, movable=true)
    ET.SubElement(root, "block", {
        "type": "profithub_bot_lock",
        "id": gen_id("lock"),
        "deletable": "false",
        "movable": "true",
        "x": "0",
        "y": "-120"
    })

    # Block 1: trade_definition
    trade_def = ET.SubElement(root, "block", {
        "type": "trade_definition",
        "id": gen_id("trade_def"),
        "deletable": "false",
        "x": "0",
        "y": "60"
    })

    # TRADE_OPTIONS
    stmt_opts = ET.SubElement(trade_def, "statement", {"name": "TRADE_OPTIONS"})
    blk_market = ET.SubElement(stmt_opts, "block", {
        "type": "trade_definition_market",
        "id": gen_id("mkt"),
        "deletable": "false",
        "movable": "false"
    })
    ET.SubElement(blk_market, "field", {"name": "MARKET_LIST"}).text = "synthetic_index"
    ET.SubElement(blk_market, "field", {"name": "SUBMARKET_LIST"}).text = "random_index"
    ET.SubElement(blk_market, "field", {"name": "SYMBOL_LIST"}).text = "1HZ100V"

    nxt1 = ET.SubElement(blk_market, "next")
    blk_tt = ET.SubElement(nxt1, "block", {
        "type": "trade_definition_tradetype",
        "id": gen_id("tt"),
        "deletable": "false",
        "movable": "false"
    })
    ET.SubElement(blk_tt, "field", {"name": "TRADETYPECAT_LIST"}).text = "digits"
    ET.SubElement(blk_tt, "field", {"name": "TRADETYPE_LIST"}).text = "overunder"

    nxt2 = ET.SubElement(blk_tt, "next")
    blk_ct = ET.SubElement(nxt2, "block", {
        "type": "trade_definition_contracttype",
        "id": gen_id("ct"),
        "deletable": "false",
        "movable": "false"
    })
    ET.SubElement(blk_ct, "field", {"name": "TYPE_LIST"}).text = "both"

    nxt3 = ET.SubElement(blk_ct, "next")
    blk_ci = ET.SubElement(nxt3, "block", {
        "type": "trade_definition_candleinterval",
        "id": gen_id("ci"),
        "deletable": "false",
        "movable": "false"
    })
    ET.SubElement(blk_ci, "field", {"name": "CANDLEINTERVAL_LIST"}).text = "60"

    nxt4 = ET.SubElement(blk_ci, "next")
    blk_rm = ET.SubElement(nxt4, "block", {
        "type": "trade_definition_restartbuysell",
        "id": gen_id("rm"),
        "deletable": "false",
        "movable": "false"
    })
    ET.SubElement(blk_rm, "field", {"name": "TIME_MACHINE_ENABLED"}).text = "FALSE"

    nxt5 = ET.SubElement(blk_rm, "next")
    blk_re = ET.SubElement(nxt5, "block", {
        "type": "trade_definition_restartonerror",
        "id": gen_id("re"),
        "deletable": "false",
        "movable": "false"
    })
    ET.SubElement(blk_re, "field", {"name": "RESTARTONERROR"}).text = "TRUE"

    # INITIALIZATION
    stmt_init = ET.SubElement(trade_def, "statement", {"name": "INITIALIZATION"})

    # Chain of variable sets in INITIALIZATION
    init_vars = [
        ("var_stake", "Stake", "math_number", str(default_stake)),
        ("var_init_stake", "InitialStake", "math_number", str(default_stake)),
        ("var_target", "TargetProfit", "math_number", str(default_target)),
        ("var_loss", "StopLoss", "math_number", str(default_loss)),
        ("var_martingale", "MartingaleMultiplier", "math_number", str(martingale_multiplier)),
        ("var_prediction", "Prediction", "math_number", str(over_prediction)),
        ("var_trade_dir", "TradeDirection", "text", "NONE"),
        ("var_pattern_found", "PatternFound", "logic_boolean", "FALSE"),
        ("var_trades_cycle", "TradesInCycle", "math_number", "0"),
        ("var_max_trades", "MaxTradesPerCycle", "math_number", str(trades_per_cycle)),
    ]

    curr_parent = stmt_init
    is_first = True
    for v_id, v_name, val_type, val_str in init_vars:
        if is_first:
            blk_var = ET.SubElement(curr_parent, "block", {
                "type": "variables_set",
                "id": gen_id("vset")
            })
            is_first = False
        else:
            nxt = ET.SubElement(curr_parent, "next")
            blk_var = ET.SubElement(nxt, "block", {
                "type": "variables_set",
                "id": gen_id("vset")
            })

        ET.SubElement(blk_var, "field", {"name": "VAR", "id": v_id}).text = v_name
        val_sub = ET.SubElement(blk_var, "value", {"name": "VALUE"})
        if val_type == "math_number":
            num_blk = ET.SubElement(val_sub, "block", {
                "type": "math_number",
                "id": gen_id("num")
            })
            ET.SubElement(num_blk, "field", {"name": "NUM"}).text = val_str
        elif val_type == "logic_boolean":
            bool_blk = ET.SubElement(val_sub, "block", {
                "type": "logic_boolean",
                "id": gen_id("bool")
            })
            ET.SubElement(bool_blk, "field", {"name": "BOOL"}).text = val_str
        elif val_type == "text":
            txt_blk = ET.SubElement(val_sub, "block", {
                "type": "text",
                "id": gen_id("txt")
            })
            ET.SubElement(txt_blk, "field", {"name": "TEXT"}).text = val_str

        curr_parent = blk_var

    # Add welcome notify after initialization variables
    nxt_notify = ET.SubElement(curr_parent, "next")
    blk_notify_init = ET.SubElement(nxt_notify, "block", {
        "type": "notify",
        "id": gen_id("notif_init")
    })
    ET.SubElement(blk_notify_init, "field", {"name": "NOTIFICATION_TYPE"}).text = "info"
    ET.SubElement(blk_notify_init, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    val_msg = ET.SubElement(blk_notify_init, "value", {"name": "MESSAGE"})
    sh_txt = ET.SubElement(val_msg, "shadow", {
        "type": "text",
        "id": gen_id("sh_txt")
    })
    sh_txt_fld = ET.SubElement(sh_txt, "field", {"name": "TEXT"})
    sh_txt_fld.text = f"🤖 {bot_name} Activated | Over {over_prediction} & Under {under_prediction} LDP Engine"

    # SUBMARKET
    stmt_sub = ET.SubElement(trade_def, "statement", {"name": "SUBMARKET"})
    blk_to = ET.SubElement(stmt_sub, "block", {
        "type": "trade_definition_tradeoptions",
        "id": gen_id("to")
    })
    ET.SubElement(blk_to, "mutation", {
        "xmlns": "http://www.w3.org/1999/xhtml",
        "has_first_barrier": "false",
        "has_second_barrier": "false",
        "has_prediction": "true"
    })
    ET.SubElement(blk_to, "field", {"name": "DURATIONTYPE_LIST"}).text = "t"

    # DURATION
    val_dur = ET.SubElement(blk_to, "value", {"name": "DURATION"})
    sh_dur = ET.SubElement(val_dur, "shadow", {"type": "math_number", "id": gen_id("sh_dur")})
    ET.SubElement(sh_dur, "field", {"name": "NUM"}).text = "1"

    # AMOUNT
    val_amt = ET.SubElement(blk_to, "value", {"name": "AMOUNT"})
    sh_amt = ET.SubElement(val_amt, "shadow", {"type": "math_number", "id": gen_id("sh_amt")})
    ET.SubElement(sh_amt, "field", {"name": "NUM"}).text = str(default_stake)
    b_amt = ET.SubElement(val_amt, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(b_amt, "field", {"name": "VAR", "id": "var_stake"}).text = "Stake"

    # PREDICTION
    val_pred = ET.SubElement(blk_to, "value", {"name": "PREDICTION"})
    sh_pred = ET.SubElement(val_pred, "shadow", {"type": "math_number_positive", "id": gen_id("sh_pred")})
    ET.SubElement(sh_pred, "field", {"name": "NUM"}).text = str(over_prediction)
    b_pred = ET.SubElement(val_pred, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(b_pred, "field", {"name": "VAR", "id": "var_prediction"}).text = "Prediction"

    # Block 2: during_purchase
    during_pur = ET.SubElement(root, "block", {
        "type": "during_purchase",
        "id": gen_id("during_pur"),
        "collapsed": "true",
        "x": "714",
        "y": "60"
    })
    stmt_dp = ET.SubElement(during_pur, "statement", {"name": "DURING_PURCHASE_STACK"})
    ctrl_dp = ET.SubElement(stmt_dp, "block", {"type": "controls_if", "id": gen_id("ctrl_dp")})
    v_dp = ET.SubElement(ctrl_dp, "value", {"name": "IF0"})
    ET.SubElement(v_dp, "block", {"type": "check_sell", "id": gen_id("chk_sell")})

    # Block 3: before_purchase
    before_pur = ET.SubElement(root, "block", {
        "type": "before_purchase",
        "id": gen_id("before_pur"),
        "deletable": "false",
        "x": "0",
        "y": "1000"
    })
    stmt_bp = ET.SubElement(before_pur, "statement", {"name": "BEFOREPURCHASE_STACK"})

    # Helper function to get tick from lastDigitList
    def build_tick_getter(tick_num, var_id, var_name):
        blk = ET.Element("block", {"type": "variables_set", "id": gen_id("vset_tick")})
        ET.SubElement(blk, "field", {"name": "VAR", "id": var_id}).text = var_name
        val = ET.SubElement(blk, "value", {"name": "VALUE"})
        gi = ET.SubElement(val, "block", {"type": "lists_getIndex", "id": gen_id("get_idx")})
        ET.SubElement(gi, "mutation", {"xmlns": "http://www.w3.org/1999/xhtml", "statement": "false", "at": "true"})
        ET.SubElement(gi, "field", {"name": "MODE"}).text = "GET"
        ET.SubElement(gi, "field", {"name": "WHERE"}).text = "FROM_END"
        v_list = ET.SubElement(gi, "value", {"name": "VALUE"})
        ET.SubElement(v_list, "block", {"type": "lastDigitList", "id": gen_id("ldl")})
        v_at = ET.SubElement(gi, "value", {"name": "AT"})
        num_at = ET.SubElement(v_at, "block", {"type": "math_number", "id": gen_id("at_num")})
        ET.SubElement(num_at, "field", {"name": "NUM"}).text = str(tick_num)
        return blk

    b_t1 = build_tick_getter(1, "var_tick_1", "Tick 1")
    stmt_bp.append(b_t1)
    nxt_t2 = ET.SubElement(b_t1, "next")
    b_t2 = build_tick_getter(2, "var_tick_2", "Tick 2")
    nxt_t2.append(b_t2)
    nxt_t3 = ET.SubElement(b_t2, "next")
    b_t3 = build_tick_getter(3, "var_tick_3", "Tick 3")
    nxt_t3.append(b_t3)
    nxt_t4 = ET.SubElement(b_t3, "next")
    b_t4 = build_tick_getter(4, "var_tick_4", "Tick 4")
    nxt_t4.append(b_t4)

    # Next after tick readers: Check if PatternFound == FALSE
    nxt_pattern_ctrl = ET.SubElement(b_t4, "next")
    ctrl_pattern = ET.SubElement(nxt_pattern_ctrl, "block", {
        "type": "controls_if",
        "id": gen_id("ctrl_pattern")
    })
    ET.SubElement(ctrl_pattern, "mutation", {
        "xmlns": "http://www.w3.org/1999/xhtml",
        "else": "1"
    })

    # IF0: PatternFound == FALSE
    val_if_not_found = ET.SubElement(ctrl_pattern, "value", {"name": "IF0"})
    cmp_not_found = ET.SubElement(val_if_not_found, "block", {
        "type": "logic_compare",
        "id": gen_id("cmp_pfound")
    })
    ET.SubElement(cmp_not_found, "field", {"name": "OP"}).text = "EQ"
    v_a = ET.SubElement(cmp_not_found, "value", {"name": "A"})
    vg_pf = ET.SubElement(v_a, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_pf, "field", {"name": "VAR", "id": "var_pattern_found"}).text = "PatternFound"
    v_b = ET.SubElement(cmp_not_found, "value", {"name": "B"})
    bl_false = ET.SubElement(v_b, "block", {"type": "logic_boolean", "id": gen_id("bool_f")})
    ET.SubElement(bl_false, "field", {"name": "BOOL"}).text = "FALSE"

    # DO0: Scan for 4-tick patterns in last 25 ticks
    stmt_scan = ET.SubElement(ctrl_pattern, "statement", {"name": "DO0"})

    ctrl_scan_if = ET.SubElement(stmt_scan, "block", {
        "type": "controls_if",
        "id": gen_id("ctrl_scan_if")
    })
    ET.SubElement(ctrl_scan_if, "mutation", {
        "xmlns": "http://www.w3.org/1999/xhtml",
        "elseif": "1",
        "else": "1"
    })

    # Helper for logic comparison of tick digit with operator and threshold
    def make_tick_cmp(tick_var_id, tick_var_name, op, num_val):
        blk = ET.Element("block", {"type": "logic_compare", "id": gen_id("cmp")})
        ET.SubElement(blk, "field", {"name": "OP"}).text = op
        va = ET.SubElement(blk, "value", {"name": "A"})
        vg = ET.SubElement(va, "block", {"type": "variables_get", "id": gen_id("vget")})
        ET.SubElement(vg, "field", {"name": "VAR", "id": tick_var_id}).text = tick_var_name
        vb = ET.SubElement(blk, "value", {"name": "B"})
        nm = ET.SubElement(vb, "block", {"type": "math_number", "id": gen_id("num")})
        ET.SubElement(nm, "field", {"name": "NUM"}).text = str(num_val)
        return blk

    # 4-tick AND condition helper
    def make_4_ticks_and(op, num_val):
        # (Tick1 op num AND Tick2 op num) AND (Tick3 op num AND Tick4 op num)
        top_and = ET.Element("block", {"type": "logic_operation", "id": gen_id("land")})
        ET.SubElement(top_and, "field", {"name": "OP"}).text = "AND"

        left_and = ET.SubElement(top_and, "value", {"name": "A"})
        l_op = ET.SubElement(left_and, "block", {"type": "logic_operation", "id": gen_id("land")})
        ET.SubElement(l_op, "field", {"name": "OP"}).text = "AND"
        val_t1 = ET.SubElement(l_op, "value", {"name": "A"})
        val_t1.append(make_tick_cmp("var_tick_1", "Tick 1", op, num_val))
        val_t2 = ET.SubElement(l_op, "value", {"name": "B"})
        val_t2.append(make_tick_cmp("var_tick_2", "Tick 2", op, num_val))

        right_and = ET.SubElement(top_and, "value", {"name": "B"})
        r_op = ET.SubElement(right_and, "block", {"type": "logic_operation", "id": gen_id("land")})
        ET.SubElement(r_op, "field", {"name": "OP"}).text = "AND"
        val_t3 = ET.SubElement(r_op, "value", {"name": "A"})
        val_t3.append(make_tick_cmp("var_tick_3", "Tick 3", op, num_val))
        val_t4 = ET.SubElement(r_op, "value", {"name": "B"})
        val_t4.append(make_tick_cmp("var_tick_4", "Tick 4", op, num_val))

        return top_and

    # IF0: 4 Over pattern (Tick1 > over_prediction ... Tick4 > over_prediction)
    v_if_over = ET.SubElement(ctrl_scan_if, "value", {"name": "IF0"})
    v_if_over.append(make_4_ticks_and("GT", over_prediction))

    # DO0: Set TradeDirection = "OVER", Prediction = over_prediction, PatternFound = TRUE
    stmt_do_over = ET.SubElement(ctrl_scan_if, "statement", {"name": "DO0"})
    b_set_td_o = ET.SubElement(stmt_do_over, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_set_td_o, "field", {"name": "VAR", "id": "var_trade_dir"}).text = "TradeDirection"
    v_o = ET.SubElement(b_set_td_o, "value", {"name": "VALUE"})
    t_o = ET.SubElement(v_o, "block", {"type": "text", "id": gen_id("txt")})
    ET.SubElement(t_o, "field", {"name": "TEXT"}).text = "OVER"

    nxt_so2 = ET.SubElement(b_set_td_o, "next")
    b_set_pred_o = ET.SubElement(nxt_so2, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_set_pred_o, "field", {"name": "VAR", "id": "var_prediction"}).text = "Prediction"
    v_pred_o = ET.SubElement(b_set_pred_o, "value", {"name": "VALUE"})
    num_pred_o = ET.SubElement(v_pred_o, "block", {"type": "math_number", "id": gen_id("num")})
    ET.SubElement(num_pred_o, "field", {"name": "NUM"}).text = str(over_prediction)

    nxt_so3 = ET.SubElement(b_set_pred_o, "next")
    b_set_pf_o = ET.SubElement(nxt_so3, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_set_pf_o, "field", {"name": "VAR", "id": "var_pattern_found"}).text = "PatternFound"
    v_pf_o = ET.SubElement(b_set_pf_o, "value", {"name": "VALUE"})
    b_true_o = ET.SubElement(v_pf_o, "block", {"type": "logic_boolean", "id": gen_id("bool")})
    ET.SubElement(b_true_o, "field", {"name": "BOOL"}).text = "TRUE"

    nxt_so4 = ET.SubElement(b_set_pf_o, "next")
    b_notif_o = ET.SubElement(nxt_so4, "block", {"type": "notify", "id": gen_id("notif")})
    ET.SubElement(b_notif_o, "field", {"name": "NOTIFICATION_TYPE"}).text = "success"
    ET.SubElement(b_notif_o, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_o = ET.SubElement(b_notif_o, "value", {"name": "MESSAGE"})
    sh_m_o = ET.SubElement(v_msg_o, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_m_o, "field", {"name": "TEXT"}).text = f"🎯 4 Over digits detected! Strategy locked: OVER {over_prediction} (Waiting for entry digit {'/'.join(map(str, over_entry_digits))})..."

    # IF1: 4 Under pattern (Tick1 < under_prediction ... Tick4 < under_prediction)
    v_if_under = ET.SubElement(ctrl_scan_if, "value", {"name": "IF1"})
    v_if_under.append(make_4_ticks_and("LT", under_prediction))

    # DO1: Set TradeDirection = "UNDER", Prediction = under_prediction, PatternFound = TRUE
    stmt_do_under = ET.SubElement(ctrl_scan_if, "statement", {"name": "DO1"})
    b_set_td_u = ET.SubElement(stmt_do_under, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_set_td_u, "field", {"name": "VAR", "id": "var_trade_dir"}).text = "TradeDirection"
    v_u = ET.SubElement(b_set_td_u, "value", {"name": "VALUE"})
    t_u = ET.SubElement(v_u, "block", {"type": "text", "id": gen_id("txt")})
    ET.SubElement(t_u, "field", {"name": "TEXT"}).text = "UNDER"

    nxt_su2 = ET.SubElement(b_set_td_u, "next")
    b_set_pred_u = ET.SubElement(nxt_su2, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_set_pred_u, "field", {"name": "VAR", "id": "var_prediction"}).text = "Prediction"
    v_pred_u = ET.SubElement(b_set_pred_u, "value", {"name": "VALUE"})
    num_pred_u = ET.SubElement(v_pred_u, "block", {"type": "math_number", "id": gen_id("num")})
    ET.SubElement(num_pred_u, "field", {"name": "NUM"}).text = str(under_prediction)

    nxt_su3 = ET.SubElement(b_set_pred_u, "next")
    b_set_pf_u = ET.SubElement(nxt_su3, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_set_pf_u, "field", {"name": "VAR", "id": "var_pattern_found"}).text = "PatternFound"
    v_pf_u = ET.SubElement(b_set_pf_u, "value", {"name": "VALUE"})
    b_true_u = ET.SubElement(v_pf_u, "block", {"type": "logic_boolean", "id": gen_id("bool")})
    ET.SubElement(b_true_u, "field", {"name": "BOOL"}).text = "TRUE"

    nxt_su4 = ET.SubElement(b_set_pf_u, "next")
    b_notif_u = ET.SubElement(nxt_su4, "block", {"type": "notify", "id": gen_id("notif")})
    ET.SubElement(b_notif_u, "field", {"name": "NOTIFICATION_TYPE"}).text = "warn"
    ET.SubElement(b_notif_u, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_u = ET.SubElement(b_notif_u, "value", {"name": "MESSAGE"})
    sh_m_u = ET.SubElement(v_msg_u, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_m_u, "field", {"name": "TEXT"}).text = f"🎯 4 Under digits detected! Strategy locked: UNDER {under_prediction} (Waiting for entry digit {'/'.join(map(str, under_entry_digits))})..."

    # ELSE in scan: Still scanning
    stmt_scan_else = ET.SubElement(ctrl_scan_if, "statement", {"name": "ELSE"})
    b_scan_notif = ET.SubElement(stmt_scan_else, "block", {"type": "notify", "id": gen_id("notif_scan")})
    ET.SubElement(b_scan_notif, "field", {"name": "NOTIFICATION_TYPE"}).text = "info"
    ET.SubElement(b_scan_notif, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_scan_m = ET.SubElement(b_scan_notif, "value", {"name": "MESSAGE"})
    sh_sm = ET.SubElement(v_scan_m, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_sm, "field", {"name": "TEXT"}).text = f"🔍 {bot_name}: Analyzing 25 Ticks LDP... Waiting for 4 Over/Under pattern."

    # ELSE in PatternFound (PatternFound is TRUE -> Check Entry Digits & Execute Purchase!)
    stmt_trade_exec = ET.SubElement(ctrl_pattern, "statement", {"name": "ELSE"})

    ctrl_entry_if = ET.SubElement(stmt_trade_exec, "block", {
        "type": "controls_if",
        "id": gen_id("ctrl_entry_if")
    })
    ET.SubElement(ctrl_entry_if, "mutation", {
        "xmlns": "http://www.w3.org/1999/xhtml",
        "elseif": "1"
    })

    # Helper to construct multiple OR conditions for entry digits: e.g. Tick1 == 0 or Tick1 == 1 or Tick1 == 2
    def make_entry_digits_condition(digits_list):
        if len(digits_list) == 1:
            return make_tick_cmp("var_tick_1", "Tick 1", "EQ", digits_list[0])
        elif len(digits_list) == 2:
            blk_or = ET.Element("block", {"type": "logic_operation", "id": gen_id("lor")})
            ET.SubElement(blk_or, "field", {"name": "OP"}).text = "OR"
            va = ET.SubElement(blk_or, "value", {"name": "A"})
            va.append(make_tick_cmp("var_tick_1", "Tick 1", "EQ", digits_list[0]))
            vb = ET.SubElement(blk_or, "value", {"name": "B"})
            vb.append(make_tick_cmp("var_tick_1", "Tick 1", "EQ", digits_list[1]))
            return blk_or
        elif len(digits_list) == 3:
            # (Tick1 == d0 OR Tick1 == d1) OR (Tick1 == d2)
            top_or = ET.Element("block", {"type": "logic_operation", "id": gen_id("lor")})
            ET.SubElement(top_or, "field", {"name": "OP"}).text = "OR"
            va = ET.SubElement(top_or, "value", {"name": "A"})
            sub_or = ET.SubElement(va, "block", {"type": "logic_operation", "id": gen_id("lor")})
            ET.SubElement(sub_or, "field", {"name": "OP"}).text = "OR"
            sub_a = ET.SubElement(sub_or, "value", {"name": "A"})
            sub_a.append(make_tick_cmp("var_tick_1", "Tick 1", "EQ", digits_list[0]))
            sub_b = ET.SubElement(sub_or, "value", {"name": "B"})
            sub_b.append(make_tick_cmp("var_tick_1", "Tick 1", "EQ", digits_list[1]))
            vb = ET.SubElement(top_or, "value", {"name": "B"})
            vb.append(make_tick_cmp("var_tick_1", "Tick 1", "EQ", digits_list[2]))
            return top_or

    # IF0: TradeDirection == "OVER" AND (Tick1 in over_entry_digits)
    v_if_entry_o = ET.SubElement(ctrl_entry_if, "value", {"name": "IF0"})
    land_entry_o = ET.SubElement(v_if_entry_o, "block", {"type": "logic_operation", "id": gen_id("land")})
    ET.SubElement(land_entry_o, "field", {"name": "OP"}).text = "AND"

    v_td_cmp_o = ET.SubElement(land_entry_o, "value", {"name": "A"})
    cmp_td_o = ET.SubElement(v_td_cmp_o, "block", {"type": "logic_compare", "id": gen_id("cmp_td")})
    ET.SubElement(cmp_td_o, "field", {"name": "OP"}).text = "EQ"
    v_tda_o = ET.SubElement(cmp_td_o, "value", {"name": "A"})
    vg_tda_o = ET.SubElement(v_tda_o, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_tda_o, "field", {"name": "VAR", "id": "var_trade_dir"}).text = "TradeDirection"
    v_tdb_o = ET.SubElement(cmp_td_o, "value", {"name": "B"})
    t_tdb_o = ET.SubElement(v_tdb_o, "block", {"type": "text", "id": gen_id("txt")})
    ET.SubElement(t_tdb_o, "field", {"name": "TEXT"}).text = "OVER"

    v_dig_cmp_o = ET.SubElement(land_entry_o, "value", {"name": "B"})
    v_dig_cmp_o.append(make_entry_digits_condition(over_entry_digits))

    # DO0: Notify and purchase DIGITOVER
    stmt_do_pur_o = ET.SubElement(ctrl_entry_if, "statement", {"name": "DO0"})
    b_notif_pur_o = ET.SubElement(stmt_do_pur_o, "block", {"type": "notify", "id": gen_id("notif")})
    ET.SubElement(b_notif_pur_o, "field", {"name": "NOTIFICATION_TYPE"}).text = "success"
    ET.SubElement(b_notif_pur_o, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_po = ET.SubElement(b_notif_pur_o, "value", {"name": "MESSAGE"})
    sh_m_po = ET.SubElement(v_msg_po, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_m_po, "field", {"name": "TEXT"}).text = f"🚀 Entry Confirmed! Purchasing DIGITOVER with Prediction {over_prediction}..."

    nxt_po = ET.SubElement(b_notif_pur_o, "next")
    b_pur_o = ET.SubElement(nxt_po, "block", {"type": "purchase", "id": gen_id("pur_over")})
    ET.SubElement(b_pur_o, "field", {"name": "PURCHASE_LIST"}).text = "DIGITOVER"

    # IF1: TradeDirection == "UNDER" AND (Tick1 in under_entry_digits)
    v_if_entry_u = ET.SubElement(ctrl_entry_if, "value", {"name": "IF1"})
    land_entry_u = ET.SubElement(v_if_entry_u, "block", {"type": "logic_operation", "id": gen_id("land")})
    ET.SubElement(land_entry_u, "field", {"name": "OP"}).text = "AND"

    v_td_cmp_u = ET.SubElement(land_entry_u, "value", {"name": "A"})
    cmp_td_u = ET.SubElement(v_td_cmp_u, "block", {"type": "logic_compare", "id": gen_id("cmp_td")})
    ET.SubElement(cmp_td_u, "field", {"name": "OP"}).text = "EQ"
    v_tda_u = ET.SubElement(cmp_td_u, "value", {"name": "A"})
    vg_tda_u = ET.SubElement(v_tda_u, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_tda_u, "field", {"name": "VAR", "id": "var_trade_dir"}).text = "TradeDirection"
    v_tdb_u = ET.SubElement(cmp_td_u, "value", {"name": "B"})
    t_tdb_u = ET.SubElement(v_tdb_u, "block", {"type": "text", "id": gen_id("txt")})
    ET.SubElement(t_tdb_u, "field", {"name": "TEXT"}).text = "UNDER"

    v_dig_cmp_u = ET.SubElement(land_entry_u, "value", {"name": "B"})
    v_dig_cmp_u.append(make_entry_digits_condition(under_entry_digits))

    # DO1: Notify and purchase DIGITUNDER
    stmt_do_pur_u = ET.SubElement(ctrl_entry_if, "statement", {"name": "DO1"})
    b_notif_pur_u = ET.SubElement(stmt_do_pur_u, "block", {"type": "notify", "id": gen_id("notif")})
    ET.SubElement(b_notif_pur_u, "field", {"name": "NOTIFICATION_TYPE"}).text = "warn"
    ET.SubElement(b_notif_pur_u, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_pu = ET.SubElement(b_notif_pur_u, "value", {"name": "MESSAGE"})
    sh_m_pu = ET.SubElement(v_msg_pu, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_m_pu, "field", {"name": "TEXT"}).text = f"🚀 Entry Confirmed! Purchasing DIGITUNDER with Prediction {under_prediction}..."

    nxt_pu = ET.SubElement(b_notif_pur_u, "next")
    b_pur_u = ET.SubElement(nxt_pu, "block", {"type": "purchase", "id": gen_id("pur_under")})
    ET.SubElement(b_pur_u, "field", {"name": "PURCHASE_LIST"}).text = "DIGITUNDER"

    # Block 4: after_purchase
    after_pur = ET.SubElement(root, "block", {
        "type": "after_purchase",
        "id": gen_id("after_pur"),
        "x": "714",
        "y": "300"
    })
    stmt_ap = ET.SubElement(after_pur, "statement", {"name": "AFTERPURCHASE_STACK"})

    # Check Win or Loss
    ctrl_win_loss = ET.SubElement(stmt_ap, "block", {
        "type": "controls_if",
        "id": gen_id("ctrl_win_loss")
    })
    ET.SubElement(ctrl_win_loss, "mutation", {
        "xmlns": "http://www.w3.org/1999/xhtml",
        "else": "1"
    })

    # IF0: Win
    v_if_win = ET.SubElement(ctrl_win_loss, "value", {"name": "IF0"})
    chk_win = ET.SubElement(v_if_win, "block", {"type": "contract_check_result", "id": gen_id("chk_win")})
    ET.SubElement(chk_win, "field", {"name": "CHECK_RESULT"}).text = "win"

    # DO0: Reset Stake = InitialStake
    stmt_do_win = ET.SubElement(ctrl_win_loss, "statement", {"name": "DO0"})
    b_reset_stk = ET.SubElement(stmt_do_win, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_reset_stk, "field", {"name": "VAR", "id": "var_stake"}).text = "Stake"
    v_stk_win = ET.SubElement(b_reset_stk, "value", {"name": "VALUE"})
    vg_init_stk = ET.SubElement(v_stk_win, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_init_stk, "field", {"name": "VAR", "id": "var_init_stake"}).text = "InitialStake"

    nxt_notif_w = ET.SubElement(b_reset_stk, "next")
    b_notif_w = ET.SubElement(nxt_notif_w, "block", {"type": "notify", "id": gen_id("notif_win")})
    ET.SubElement(b_notif_w, "field", {"name": "NOTIFICATION_TYPE"}).text = "success"
    ET.SubElement(b_notif_w, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_w = ET.SubElement(b_notif_w, "value", {"name": "MESSAGE"})
    sh_mw = ET.SubElement(v_msg_w, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_mw, "field", {"name": "TEXT"}).text = "🎉 Trade WON! Stake reset to initial."

    # ELSE: Loss -> Stake = Stake * Martingale
    stmt_do_loss = ET.SubElement(ctrl_win_loss, "statement", {"name": "ELSE"})
    b_mart_stk = ET.SubElement(stmt_do_loss, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_mart_stk, "field", {"name": "VAR", "id": "var_stake"}).text = "Stake"
    v_stk_loss = ET.SubElement(b_mart_stk, "value", {"name": "VALUE"})
    math_mult = ET.SubElement(v_stk_loss, "block", {"type": "math_arithmetic", "id": gen_id("arith")})
    ET.SubElement(math_mult, "field", {"name": "OP"}).text = "MULTIPLY"
    v_ma = ET.SubElement(math_mult, "value", {"name": "A"})
    vg_curr_stk = ET.SubElement(v_ma, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_curr_stk, "field", {"name": "VAR", "id": "var_stake"}).text = "Stake"
    v_mb = ET.SubElement(math_mult, "value", {"name": "B"})
    vg_mart = ET.SubElement(v_mb, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_mart, "field", {"name": "VAR", "id": "var_martingale"}).text = "MartingaleMultiplier"

    nxt_notif_l = ET.SubElement(b_mart_stk, "next")
    b_notif_l = ET.SubElement(nxt_notif_l, "block", {"type": "notify", "id": gen_id("notif_loss")})
    ET.SubElement(b_notif_l, "field", {"name": "NOTIFICATION_TYPE"}).text = "warn"
    ET.SubElement(b_notif_l, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_l = ET.SubElement(b_notif_l, "value", {"name": "MESSAGE"})
    sh_ml = ET.SubElement(v_msg_l, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_ml, "field", {"name": "TEXT"}).text = f"⚠️ Trade LOST. Applying Martingale {martingale_multiplier}x."

    # Next: Increment TradesInCycle
    nxt_inc_cycle = ET.SubElement(ctrl_win_loss, "next")
    b_chg_cycle = ET.SubElement(nxt_inc_cycle, "block", {"type": "math_change", "id": gen_id("mchg")})
    ET.SubElement(b_chg_cycle, "field", {"name": "VAR", "id": "var_trades_cycle"}).text = "TradesInCycle"
    v_chg_d = ET.SubElement(b_chg_cycle, "value", {"name": "DELTA"})
    sh_cd = ET.SubElement(v_chg_d, "shadow", {"type": "math_number", "id": gen_id("sh_num")})
    ET.SubElement(sh_cd, "field", {"name": "NUM"}).text = "1"

    # Next: Check Target Profit & Stop Loss
    nxt_check_limits = ET.SubElement(b_chg_cycle, "next")
    ctrl_limits = ET.SubElement(nxt_check_limits, "block", {"type": "controls_if", "id": gen_id("ctrl_limits")})
    ET.SubElement(ctrl_limits, "mutation", {
        "xmlns": "http://www.w3.org/1999/xhtml",
        "elseif": "1",
        "else": "1"
    })

    # IF0: total_profit >= TargetProfit
    v_if_tp = ET.SubElement(ctrl_limits, "value", {"name": "IF0"})
    cmp_tp = ET.SubElement(v_if_tp, "block", {"type": "logic_compare", "id": gen_id("cmp_tp")})
    ET.SubElement(cmp_tp, "field", {"name": "OP"}).text = "GTE"
    v_tpa = ET.SubElement(cmp_tp, "value", {"name": "A"})
    ET.SubElement(v_tpa, "block", {"type": "total_profit", "id": gen_id("tot_prof")})
    v_tpb = ET.SubElement(cmp_tp, "value", {"name": "B"})
    vg_tp = ET.SubElement(v_tpb, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_tp, "field", {"name": "VAR", "id": "var_target"}).text = "TargetProfit"

    # DO0: Target profit reached notification (no trade_again, stops bot)
    stmt_do_tp = ET.SubElement(ctrl_limits, "statement", {"name": "DO0"})
    b_notif_tp = ET.SubElement(stmt_do_tp, "block", {"type": "notify", "id": gen_id("notif_tp")})
    ET.SubElement(b_notif_tp, "field", {"name": "NOTIFICATION_TYPE"}).text = "success"
    ET.SubElement(b_notif_tp, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_tp = ET.SubElement(b_notif_tp, "value", {"name": "MESSAGE"})
    sh_mtp = ET.SubElement(v_msg_tp, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_mtp, "field", {"name": "TEXT"}).text = f"🏆 TARGET PROFIT ACHIEVED! {bot_name} stopping successfully."

    # IF1: total_profit <= -StopLoss
    v_if_sl = ET.SubElement(ctrl_limits, "value", {"name": "IF1"})
    cmp_sl = ET.SubElement(v_if_sl, "block", {"type": "logic_compare", "id": gen_id("cmp_sl")})
    ET.SubElement(cmp_sl, "field", {"name": "OP"}).text = "LTE"
    v_sla = ET.SubElement(cmp_sl, "value", {"name": "A"})
    ET.SubElement(v_sla, "block", {"type": "total_profit", "id": gen_id("tot_prof")})
    v_slb = ET.SubElement(cmp_sl, "value", {"name": "B"})
    sngl_neg = ET.SubElement(v_slb, "block", {"type": "math_single", "id": gen_id("math_neg")})
    ET.SubElement(sngl_neg, "field", {"name": "OP"}).text = "NEG"
    v_num_neg = ET.SubElement(sngl_neg, "value", {"name": "NUM"})
    vg_sl = ET.SubElement(v_num_neg, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_sl, "field", {"name": "VAR", "id": "var_loss"}).text = "StopLoss"

    # DO1: Stop loss hit notification (no trade_again, stops bot)
    stmt_do_sl = ET.SubElement(ctrl_limits, "statement", {"name": "DO1"})
    b_notif_sl = ET.SubElement(stmt_do_sl, "block", {"type": "notify", "id": gen_id("notif_sl")})
    ET.SubElement(b_notif_sl, "field", {"name": "NOTIFICATION_TYPE"}).text = "error"
    ET.SubElement(b_notif_sl, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_sl = ET.SubElement(b_notif_sl, "value", {"name": "MESSAGE"})
    sh_msl = ET.SubElement(v_msg_sl, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_msl, "field", {"name": "TEXT"}).text = f"🛑 STOP LOSS LIMIT HIT! {bot_name} stopping to protect balance."

    # ELSE: Neither TP nor SL hit -> Check 5-Trade Cycle Limit!
    stmt_else_limits = ET.SubElement(ctrl_limits, "statement", {"name": "ELSE"})

    ctrl_cycle = ET.SubElement(stmt_else_limits, "block", {"type": "controls_if", "id": gen_id("ctrl_cycle")})
    ET.SubElement(ctrl_cycle, "mutation", {
        "xmlns": "http://www.w3.org/1999/xhtml",
        "else": "1"
    })

    # IF0: TradesInCycle >= MaxTradesPerCycle (5)
    v_if_cycle = ET.SubElement(ctrl_cycle, "value", {"name": "IF0"})
    cmp_cycle = ET.SubElement(v_if_cycle, "block", {"type": "logic_compare", "id": gen_id("cmp_cycle")})
    ET.SubElement(cmp_cycle, "field", {"name": "OP"}).text = "GTE"
    v_cyca = ET.SubElement(cmp_cycle, "value", {"name": "A"})
    vg_cyca = ET.SubElement(v_cyca, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_cyca, "field", {"name": "VAR", "id": "var_trades_cycle"}).text = "TradesInCycle"
    v_cycb = ET.SubElement(cmp_cycle, "value", {"name": "B"})
    vg_cycb = ET.SubElement(v_cycb, "block", {"type": "variables_get", "id": gen_id("vget")})
    ET.SubElement(vg_cycb, "field", {"name": "VAR", "id": "var_max_trades"}).text = "MaxTradesPerCycle"

    # DO0: Completed 5 trades! Reset TradesInCycle = 0, PatternFound = FALSE, TradeDirection = "NONE", notify, trade_again
    stmt_do_cycle_end = ET.SubElement(ctrl_cycle, "statement", {"name": "DO0"})
    b_rst_cyc = ET.SubElement(stmt_do_cycle_end, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_rst_cyc, "field", {"name": "VAR", "id": "var_trades_cycle"}).text = "TradesInCycle"
    v_rc = ET.SubElement(b_rst_cyc, "value", {"name": "VALUE"})
    nm_rc = ET.SubElement(v_rc, "block", {"type": "math_number", "id": gen_id("num")})
    ET.SubElement(nm_rc, "field", {"name": "NUM"}).text = "0"

    nxt_rc2 = ET.SubElement(b_rst_cyc, "next")
    b_rst_pf = ET.SubElement(nxt_rc2, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_rst_pf, "field", {"name": "VAR", "id": "var_pattern_found"}).text = "PatternFound"
    v_rpf = ET.SubElement(b_rst_pf, "value", {"name": "VALUE"})
    bl_rpf = ET.SubElement(v_rpf, "block", {"type": "logic_boolean", "id": gen_id("bool")})
    ET.SubElement(bl_rpf, "field", {"name": "BOOL"}).text = "FALSE"

    nxt_rc3 = ET.SubElement(b_rst_pf, "next")
    b_rst_td = ET.SubElement(nxt_rc3, "block", {"type": "variables_set", "id": gen_id("vset")})
    ET.SubElement(b_rst_td, "field", {"name": "VAR", "id": "var_trade_dir"}).text = "TradeDirection"
    v_rtd = ET.SubElement(b_rst_td, "value", {"name": "VALUE"})
    t_rtd = ET.SubElement(v_rtd, "block", {"type": "text", "id": gen_id("txt")})
    ET.SubElement(t_rtd, "field", {"name": "TEXT"}).text = "NONE"

    nxt_rc4 = ET.SubElement(b_rst_td, "next")
    b_notif_cyc_done = ET.SubElement(nxt_rc4, "block", {"type": "notify", "id": gen_id("notif_cyc")})
    ET.SubElement(b_notif_cyc_done, "field", {"name": "NOTIFICATION_TYPE"}).text = "info"
    ET.SubElement(b_notif_cyc_done, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_cd = ET.SubElement(b_notif_cyc_done, "value", {"name": "MESSAGE"})
    sh_mcd = ET.SubElement(v_msg_cd, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_mcd, "field", {"name": "TEXT"}).text = f"🔄 5 trades placed in cycle. Pausing to re-analyze last 25 ticks & waiting for next 4-digit pattern..."

    nxt_rc5 = ET.SubElement(b_notif_cyc_done, "next")
    ET.SubElement(nxt_rc5, "block", {"type": "trade_again", "id": gen_id("ta")})

    # ELSE in cycle: Still in current cycle (trade < 5) -> notify progress and trade_again
    stmt_else_cycle = ET.SubElement(ctrl_cycle, "statement", {"name": "ELSE"})
    b_notif_mid_cyc = ET.SubElement(stmt_else_cycle, "block", {"type": "notify", "id": gen_id("notif_mid")})
    ET.SubElement(b_notif_mid_cyc, "field", {"name": "NOTIFICATION_TYPE"}).text = "info"
    ET.SubElement(b_notif_mid_cyc, "field", {"name": "NOTIFICATION_SOUND"}).text = "silent"
    v_msg_mc = ET.SubElement(b_notif_mid_cyc, "value", {"name": "MESSAGE"})
    sh_mmc = ET.SubElement(v_msg_mc, "shadow", {"type": "text", "id": gen_id("sh_txt")})
    ET.SubElement(sh_mmc, "field", {"name": "TEXT"}).text = f"⚡ Trade complete. Waiting for next entry trigger in current 5-trade cycle..."

    nxt_mc2 = ET.SubElement(b_notif_mid_cyc, "next")
    ET.SubElement(nxt_mc2, "block", {"type": "trade_again", "id": gen_id("ta")})

    # Return prettified XML string
    rough_string = ET.tostring(root, 'utf-8')
    reparsed = minidom.parseString(rough_string)
    pretty_xml = reparsed.toprettyxml(indent="  ")
    
    # Remove XML declaration line to match Deriv DBot standard
    lines = pretty_xml.split("\n")
    if lines[0].startswith("<?xml"):
        lines = lines[1:]
    return "\n".join(lines).strip()

# Generate Bot 1: Brixxie Auto (Over 2 / Under 7)
bot1_xml = create_bot_xml(
    bot_name="Brixxie Auto",
    over_prediction=2,
    under_prediction=7,
    over_entry_digits=[0, 1, 2],
    under_entry_digits=[7, 8, 9],
    default_stake=0.35,
    default_target=10.0,
    default_loss=50.0,
    martingale_multiplier=2.0,
    trades_per_cycle=5
)

# Generate Bot 2: Deriv auto X (Over 1 / Under 8)
bot2_xml = create_bot_xml(
    bot_name="Deriv auto X",
    over_prediction=1,
    under_prediction=8,
    over_entry_digits=[0, 1],
    under_entry_digits=[8, 9],
    default_stake=0.35,
    default_target=10.0,
    default_loss=50.0,
    martingale_multiplier=2.0,
    trades_per_cycle=5
)

# Output directories
base_dir = r"e:\Backup\Profithubexpertnew-main\public\xml-uploads"

path_bot1 = os.path.join(base_dir, "Brixxie Auto.xml")
path_bot2 = os.path.join(base_dir, "Deriv auto X.xml")

with open(path_bot1, "w", encoding="utf-8") as f:
    f.write(bot1_xml)

with open(path_bot2, "w", encoding="utf-8") as f:
    f.write(bot2_xml)

print(f"Generated {path_bot1} ({len(bot1_xml)} bytes)")
print(f"Generated {path_bot2} ({len(bot2_xml)} bytes)")
