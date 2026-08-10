#!/usr/bin/env python3
from pathlib import Path

OUT = Path(__file__).resolve().parent
IMG = OUT / "imgs"
img_hpp = (IMG / "hppzyy-64xh200_3_2081062883509866496.jpg").resolve().as_uri()
img_song = (IMG / "songexp-full-deploy-cost_3_2081236219074367488.jpg").resolve().as_uri()
img_cline = (IMG / "cline-selfhost-savings_3_2079295148870230016.jpg").resolve().as_uri()


def leaf(s: str) -> str:
    return f'<span leaf="">{s}</span>'


def p(text_html: str, mb: int = 22) -> str:
    return (
        f'<p style="margin-bottom:{mb}px;font-size:16px;line-height:1.75;'
        f'text-align:justify;color:#52525B;letter-spacing:0.3px;">\n  {text_html}\n</p>'
    )


def u(s: str) -> str:
    return (
        f'<span style="border-bottom:2px solid #52525B;font-weight:600;color:#27272A;">'
        f'<span leaf="">{s}</span></span>'
    )


def bold(s: str) -> str:
    return f'<strong style="color:#27272A;"><span leaf="">{s}</span></strong>'


def tag(s: str) -> str:
    return (
        f'<span style="background:#F4F4F5;color:#27272A;padding:2px 7px;border-radius:3px;'
        f'font-weight:700;font-size:14px;"><span leaf="">{s}</span></span>'
    )


def h2(num: str, en: str, zh: str, first: bool = False) -> str:
    mt = 16 if first else 56
    return f'''
<section style="margin-top:{mt}px;margin-bottom:32px;padding:0 10px;">
  <section style="position:relative;padding-bottom:20px;border-bottom:1px solid #E4E4E7;">
    <p style="font-size:48px;font-weight:900;color:#E4E4E7;margin:0;line-height:1;letter-spacing:-2px;">
      <span leaf="">{num}</span>
    </p>
    <section style="margin-top:-8px;">
      <p style="font-size:10px;color:#A1A1AA;font-weight:500;letter-spacing:3px;margin:0 0 6px;text-transform:uppercase;">
        <span leaf="">{en}</span>
      </p>
      <h3 style="font-size:20px;font-weight:800;color:#27272A;margin:0;letter-spacing:0.5px;line-height:1.4;">
        <span leaf="">{zh}</span>
      </h3>
    </section>
  </section>
</section>'''


def h3(s: str) -> str:
    return f'''<p style="font-size:16px;font-weight:800;color:#27272A;margin:28px 0 14px;padding:0 10px 0 22px;border-left:3px solid #52525B;line-height:1.4;margin-left:10px;">
  <span leaf="">{s}</span>
</p>'''


def quote(s: str) -> str:
    return f'''<section style="border-left:3px solid #52525B;padding:16px 0 16px 24px;margin:0 10px 28px;">
  <p style="font-size:16px;font-weight:700;color:#27272A;margin:0;line-height:1.7;letter-spacing:0.5px;">
    <span leaf="">「{s}」</span>
  </p>
</section>'''


def ref_block(label: str, body_html: str) -> str:
    return f'''<section style="background:#FAFAFA;border:1px solid #E4E4E7;padding:20px 22px;margin:0 10px 28px;">
  <p style="font-size:11px;color:#A1A1AA;margin:0 0 8px;letter-spacing:2px;font-weight:500;">
    <span leaf="">{label}</span>
  </p>
  {body_html}
</section>'''


def img(src: str, cap: str) -> str:
    return f'''<section style="border:1px solid #E4E4E7;padding:4px;margin:0 10px 8px;">
  <section style="margin:0;overflow:hidden;">
    <span leaf=""><img src="{src}" style="max-width:100%;height:auto;display:block;margin:0 auto;"></span>
  </section>
</section>
<p style="font-size:12px;color:#A1A1AA;text-align:center;margin:0 10px 28px;letter-spacing:0.5px;">
  <span leaf="">— {cap}</span>
</p>'''


def table(headers, rows) -> str:
    ths = "".join(
        f'<th style="background:#27272A;color:#fff;font-weight:700;padding:8px 12px;text-align:left;">'
        f'<span leaf="">{h}</span></th>'
        for h in headers
    )
    trs = []
    for i, row in enumerate(rows):
        bg = "background:#FAFAFA;" if i % 2 else ""
        tds = "".join(
            f'<td style="padding:8px 12px;border-bottom:1px solid #E4E4E7;color:#52525B;{bg}">'
            f'<span leaf="">{c}</span></td>'
            for c in row
        )
        trs.append(f"<tr>{tds}</tr>")
    return f'''<section style="margin:0 10px 24px;overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead><tr>{ths}</tr></thead>
    <tbody>{"".join(trs)}</tbody>
  </table>
</section>'''


def divider() -> str:
    return '''<section style="padding:0 10px;margin:8px 0;">
  <section style="height:1px;background:#E4E4E7;margin:0;">
    <span leaf=""><br></span>
  </section>
</section>'''


def data_cards(items) -> str:
    parts = []
    for i, (num, label) in enumerate(items):
        mr = "margin-right:8px;" if i < len(items) - 1 else ""
        parts.append(
            f'''<section style="flex:1;border:1px solid #E4E4E7;padding:22px 12px;{mr}text-align:center;">
    <p style="font-size:22px;font-weight:900;color:#27272A;margin:0 0 6px;line-height:1.2;letter-spacing:-0.5px;"><span leaf="">{num}</span></p>
    <p style="font-size:11px;color:#A1A1AA;margin:0;letter-spacing:0.5px;line-height:1.4;"><span leaf="">{label}</span></p>
  </section>'''
        )
    return f'<section style="display:flex;margin:0 10px 28px;">{"".join(parts)}</section>'


def main() -> None:
    parts: list[str] = []
    parts.append(
        '''<section style="max-width:677px;margin:0 auto;background:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#52525B;line-height:1.75;letter-spacing:0.3px;overflow-x:hidden;">'''
    )

    parts.append(
        '''
  <section style="margin:10px 10px 40px;padding:32px 24px 24px;border-top:1px solid #E4E4E7;border-bottom:1px solid #E4E4E7;background:#FFFFFF;">
    <p style="font-size:11px;color:#A1A1AA;letter-spacing:2px;margin:0 0 18px;font-weight:400;">
      <span leaf="">QUOTE</span>
    </p>
    <p style="font-size:18px;font-weight:700;color:#27272A;margin:0 0 8px;line-height:1.7;letter-spacing:0.5px;">
      <span leaf="">开放权重降低了「下载权」，没有降低</span>
      <span style="border-bottom:2px solid #F97316;font-weight:700;color:#27272A;"><span leaf="">算力门槛</span></span>
      <span leaf="">。</span>
    </p>
    <p style="text-align:right;font-size:12px;color:#A1A1AA;margin:16px 0 0;letter-spacing:1px;">
      <span leaf="">—— ziikoo 研究院</span>
    </p>
  </section>
'''
    )

    parts.append(
        '''
<section style="background:#FAFAFA;border:1px solid #E4E4E7;padding:18px 20px;margin:0 10px 28px;">
  <p style="font-size:11px;color:#A1A1AA;margin:0 0 10px;letter-spacing:2px;font-weight:500;">
    <span leaf="">META</span>
  </p>
  <p style="font-size:13px;color:#71717A;margin:0 0 6px;line-height:1.7;letter-spacing:0.5px;">
    <span leaf="">系列：大模型落地与算力账本 · 整理：ziikoo 研究院 · 2026-07</span>
  </p>
  <p style="font-size:13px;color:#71717A;margin:0;line-height:1.7;letter-spacing:0.5px;">
    <span leaf="">素材来自 X 上公开的 Kimi K3 私有化／自托管成本讨论</span>
  </p>
</section>
'''
    )
    parts.append('<section style="padding:0 10px;">')
    parts.append(p(leaf("上个月给一家公司培训，培训结束，十个人的研发团队合上笔记本。")))
    parts.append(p(leaf("投影还亮着：演示里模型写代码、改单测、答业务问题，都还像样。董事长点点头：")))
    parts.append(
        quote(
            "AI Coding 能力不错。咱们库房里有几台闲置服务器，单卡 48G 显存，私有化部署一套试试——权重不是开源了吗？"
        )
    )
    parts.append(p(leaf("话落，空气静了两秒。")))
    parts.append(p(leaf("不是泼冷水。是这句话把三个完全不同的概念叠在了一起：")))
    parts.append(
        '''
<section style="margin-bottom:24px;">
  <section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
    <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:#27272A;color:#fff;font-size:12px;font-weight:700;border-radius:50%;flex-shrink:0;margin-top:2px;"><span leaf="">1</span></span>
    <p style="font-size:16px;color:#52525B;margin:0;line-height:1.75;flex:1;"><span leaf="">会用 API（培训里刚学会的）</span></p>
  </section>
  <section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
    <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:#27272A;color:#fff;font-size:12px;font-weight:700;border-radius:50%;flex-shrink:0;margin-top:2px;"><span leaf="">2</span></span>
    <p style="font-size:16px;color:#52525B;margin:0;line-height:1.75;flex:1;"><span leaf="">权重开放可下载（新闻标题）</span></p>
  </section>
  <section style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">
    <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:#27272A;color:#fff;font-size:12px;font-weight:700;border-radius:50%;flex-shrink:0;margin-top:2px;"><span leaf="">3</span></span>
    <p style="font-size:16px;color:#52525B;margin:0;line-height:1.75;flex:1;"><span leaf="">私有化部署成公司可用服务（真正要的）</span></p>
  </section>
</section>
'''
    )
    parts.append(
        p(leaf("三者之间，隔着一整条供应链：显存、互联、机房、电费、运维编制。门槛远超「普通企业用库存机试一把」。"))
    )
    parts.append(
        p(
            leaf("下面把 X 上关于 ")
            + u("Kimi K3 权重／全量／本地／自托管")
            + leaf(" 的成本评估摊开——不是恐吓，是对齐量级。")
        )
    )
    parts.append("</section>")

    parts.append(
        '''
<section style="padding:0 10px 40px;">
  <p style="font-size:11px;color:#A1A1AA;margin:0 0 16px;letter-spacing:2px;">
    <span leaf="">本文看点</span>
  </p>
  <section style="display:flex;justify-content:space-between;">
    <section style="flex:1;background:#FAFAFA;border-top:1px solid #E4E4E7;padding:18px 12px 16px;margin-right:8px;">
      <p style="font-size:11px;color:#A1A1AA;font-weight:500;margin:0 0 8px;letter-spacing:1px;"><span leaf="">01</span></p>
      <p style="font-size:13px;font-weight:700;color:#27272A;margin:0;line-height:1.5;"><span leaf="">48G 库存 vs 1.4TB</span></p>
    </section>
    <section style="flex:1;background:#FAFAFA;border-top:1px solid #E4E4E7;padding:18px 12px 16px;margin-right:8px;">
      <p style="font-size:11px;color:#A1A1AA;font-weight:500;margin:0 0 8px;letter-spacing:1px;"><span leaf="">02</span></p>
      <p style="font-size:13px;font-weight:700;color:#27272A;margin:0;line-height:1.5;"><span leaf="">三千万只是起步</span></p>
    </section>
    <section style="flex:1;background:#FAFAFA;border-top:1px solid #E4E4E7;padding:18px 12px 16px;">
      <p style="font-size:11px;color:#A1A1AA;font-weight:500;margin:0 0 8px;letter-spacing:1px;"><span leaf="">03</span></p>
      <p style="font-size:13px;font-weight:700;color:#27272A;margin:0;line-height:1.5;"><span leaf="">自托管未必更省</span></p>
    </section>
  </section>
</section>
'''
    )

    # 01
    parts.append(h2("01", "SCALE", "先对齐：K3 是什么量级", first=True))
    parts.append('<section style="padding:0 10px;">')
    parts.append(p(leaf("社区对 K3 的常见描述（口径会随官方 README 微调，以开源日为准）：")))
    parts.append(
        table(
            ["项", "社区说法"],
            [
                ["总参数", "约 2.8T，MoE"],
                ["路由", "约 896 选 16，每次激活约 500 亿参数"],
                ["量化体量", "MXFP4 后约 1.4TB"],
                ["上下文", "约 100 万 token"],
            ],
        )
    )
    parts.append(
        p(
            leaf("@Fferr16 写得很直白：API 已经能用；「想本地跑」则是 ")
            + u("1.4TB 起步")
            + leaf("，")
            + u("Blackwell／MI400 才能舒适装载")
            + leaf("。")
        )
    )
    parts.append(
        p(
            leaf("@StatsWire 补了一刀：人人会说 you can run it locally，诚实版本是——")
            + u("最少 8×H100 才能把权重 load 进机器")
            + leaf("；单张 RTX 4090，量化也跑不了。")
        )
    )
    parts.append(p(leaf("注意两档：")))
    parts.append(p(leaf("• ") + bold("能 load") + leaf("：参数塞进显存，服务能起来。")))
    parts.append(p(leaf("• ") + bold("能当生产") + leaf("：吞吐、延迟、高可用、峰值不崩——另一张价目表。")))
    parts.append(
        p(
            leaf("库存 ")
            + tag("48G 单卡")
            + leaf("，连「能 load 全量 K3」这档都够不着。不是软件没配好，是物理体积不对。")
        )
    )
    parts.append("</section>")
    parts.append(divider())

    # 02
    parts.append(h2("02", "COST", "「算算本地要多少钱」"))
    parts.append('<section style="padding:0 10px;">')
    parts.append(p(leaf("X 上几乎同一天，出现了同一剧本——")))
    parts.append("</section>")

    parts.append(h3("① @hppzyy：最少 64 张 H200"))
    parts.append('<section style="padding:0 10px;">')
    ref_body = p(
        leaf("Kimi K3 亮相后，老板让我算算本地化部署要多少钱。算完他沉默了。想本地跑？")
        + bold("最少 64 张 H200 起步")
        + leaf("。显卡：64×H200（141GB）；网络：NVLink ＋ 800G 光模块 ＋ RDMA；CPU：双路 Xeon／EPYC；内存：每台 1–2TB DDR5。"),
        mb=0,
    )
    parts.append(ref_block("REFERENCE", ref_body))
    parts.append(p(leaf("原文：https://x.com/hppzyy/status/2081062901826433511")))
    parts.append(img(img_hpp, "来源 @hppzyy"))
    parts.append("</section>")

    parts.append(h3("② @songexp：全量部署得花多少"))
    parts.append('<section style="padding:0 10px;">')
    parts.append(
        p(leaf("同主题配图帖直接标题：") + u("全量部署 Kimi K3 得花多少？") + leaf(" 图上给出一版会让老板沉默的估算："))
    )
    parts.append(
        data_cards(
            [
                ("¥3000万+", "硬件一次性"),
                ("¥91万/年", "满载电费粗算"),
                ("64×H200", "起步卡数"),
            ]
        )
    )
    parts.append(
        table(
            ["项", "配图口径"],
            [
                ["起步硬件", "64×H200 ＋ 高速互联 ＋ 液冷 ＋ 单机柜约 160kW"],
                ["硬件一次性", "约 ¥3000 万＋"],
                ["电费（满载年）", "粗算约 ¥91 万／年（含 PUE）"],
                ["未计入", "场地、机房改造、运维编制……"],
            ],
        )
    )
    parts.append(quote("三千万只是起步。本地化部署大模型，从来都不是小老板的游戏。"))
    parts.append(p(leaf("原文：https://x.com/songexp/status/2081236228461265284")))
    parts.append(img(img_song, "来源 @songexp 成本信息图"))
    parts.append("</section>")

    parts.append(h3("③ 英文侧的量级校验"))
    parts.append('<section style="padding:0 10px;">')
    parts.append(
        table(
            ["来源", "说法"],
            [
                ["@ConstraintEdge", "内部跑 K3 约 $1M＋ 硬件，未算电与 AI ops"],
                ["@MrCollison", "高可用推演：约 $11.7M 基建 ＋ $154k／月满载"],
                ["@CircumjovialLLC", "～$100k 家用级——与 64 卡生产档不是同一物种"],
                ["@haider1", "更正：个人现实自托管 K3 不成立"],
            ],
        )
    )
    parts.append(
        p(
            leaf("同一模型被估成十万美金玩具／百万美金入门／千万级人民币集群——不是吵架，是")
            + u("目标档位不同")
            + leaf("：演示 load ≠ 业务私有化。")
        )
    )
    parts.append("</section>")
    parts.append(divider())

    # 03
    parts.append(h2("03", "REALITY", "把库存 48G 放回坐标系"))
    parts.append('<section style="padding:0 10px;">')
    parts.append(
        p(leaf("假设公司库房是常见组合：若干台 48G 显存服务器、万兆以下网络、没有 NVLink 域、没有 7×24 AI 平台组。"))
    )
    parts.append(
        table(
            ["目标", "社区门槛印象", "48G 库存"],
            [
                ["小模型／量化中小模型", "可能", "往往可行"],
                ["Load 全量 K3（～1.4TB）", "8×H100 起（仅 load）", "不够"],
                ["生产向全量", "64 卡级 H200 ＋ 高速互联", "差一个时代"],
                ["高可用 ＋ 满载 TCO", "千万美元级推演", "不在同一讨论"],
            ],
        )
    )
    parts.append(
        p(
            leaf("培训里「AI 能力不错」，证明团队会提示、会评审、会把模型嵌进研发流程；公司愿意买 ")
            + tag("API／云托管／Coding Plan")
            + leaf("。")
        )
    )
    parts.append(p(leaf("它") + bold("不证明") + leaf("：库存卡能私有化一套前沿 MoE。")))
    parts.append(
        p(leaf("开放权重解决的是「有没有权下载」；私有化解决的是「有没有卡、有没有电、有没有人扛 SLA」。"))
    )
    parts.append("</section>")
    parts.append(divider())

    # 04
    parts.append(h2("04", "ECONOMICS", "就算买得起卡，账也不一定划算"))
    parts.append('<section style="padding:0 10px;">')
    parts.append(p(leaf("很多人默认：开源权重 ＋ 自托管 ＝ 一定更省钱。")))
    parts.append(
        p(
            leaf("@cline 用生产流量算过一版（图示基于 Kimi K2.6 量级，并注明 ")
            + u("K3 权重 footprint 约 3×")
            + leaf("，经济账会不同）：")
        )
    )
    parts.append(img(img_cline, "来源 @cline · 自托管实际能省多少"))
    parts.append(
        p(
            leaf("要点：纯 API 相对地板规模自托管大约只 ")
            + u("省约 10%")
            + leaf("；弹性与调优估计可到 20%–40%；前提往往是年 token 花费很高才值得认真做。")
        )
    )
    parts.append(
        p(
            leaf("对普通企业：数据不出域可以谈专有云／小模型本地；")
            + bold("为了省钱上全量 K3 私有化")
            + leaf("——多数时候，账算完会沉默。")
        )
    )
    parts.append("</section>")
    parts.append(divider())

    # 05
    parts.append(h2("05", "BARRIERS", "门槛清单：远超普通企业可承受"))
    parts.append('<section style="padding:0 10px;">')
    parts.append(
        table(
            ["门槛", "为什么卡死 48G 库存方案"],
            [
                ["显存体积", "1.4TB 量级权重，不是「多插一张卡」"],
                ["卡间互联", "64 卡不是堆盒子，是 NVLink／超节点／光模块"],
                ["电力与制冷", "单机柜百千瓦级，普通办公楼机房没有这档"],
                ["一次性 CAPEX", "社区生产向估算：千万人民币级硬件起步"],
                ["OPEX", "电费一年可到百万量级；还有场地与值班"],
                ["编制", "AI ops／推理优化，不是「运维兼一下」"],
                ["利用率账", "中小企业 token 量不够时，自托管未必更便宜"],
                ["目标错位", "培训验收的是流程，不是机房资产周转"],
            ],
        )
    )
    parts.append(
        quote(
            "开放权重降低了「授权门槛」，没有降低「算力门槛」。私有化部署前沿大模型，仍是超节点、资本开支、平台工程的事——不是十人研发团队培训结束后的库存机实验。"
        )
    )
    parts.append("</section>")
    parts.append(divider())

    # 06
    parts.append(h2("06", "PATH", "普通企业该怎么做"))
    parts.append('<section style="padding:0 10px;">')
    parts.append(p(leaf("不反对私有化，反对") + u("用错档位") + leaf("。")))
    parts.append(p(bold("1. 继续 API／兼容网关") + leaf("——研发提效、Agent、代码助手，先用用量买能力。")))
    parts.append(
        p(bold("2. 本地只部署用得上的小模型") + leaf("——脱敏、分类、RAG、轻量 coding：7B–70B ＋ 量化，往往才是 48G 卡的主场。"))
    )
    parts.append(
        p(bold("3. 真要私有化前沿模型") + leaf("——按 64 卡级 ＋ 机房改造 ＋ 三年 TCO 立项，不要包装成「库存试跑」。"))
    )
    parts.append(
        p(bold("4. 验收标准分开") + leaf("——培训验收：人会用、流程在；私有化验收：SLA、成本／千 token——另开项目。"))
    )
    parts.append("</section>")
    parts.append(divider())

    # ∞
    parts.append(h2("∞", "THE END", "回到那个会议室"))
    parts.append('<section style="padding:0 10px;">')
    parts.append(p(leaf("董事长说：库存 48G，私有化部署一套 AI Coding 试试。")))
    parts.append(p(leaf("合适的回答可以很短——") + tag("您先坐下") + leaf("：")))
    parts.append(
        quote(
            "试小模型／内部工具链，可以。试 K3 全量私有化，先按 64 卡与两三千万级硬件谈预算——社区估的电费一年还能再加近百万，还没算人和机房。培训证明的是团队能用 AI Coding；不能证明机房能吞下 2.8T。"
        )
    )
    parts.append(p(leaf("X 上那些帖，剧本惊人一致：老板让算账 → 算完沉默 → 「公司开会讨论一下」。")))
    parts.append(
        p(
            leaf("沉默，其实是健康的。它说明有人把 ")
            + u("标题上的「开源」")
            + leaf(" 和 ")
            + u("机房里的「可运行」")
            + leaf(" 重新分开了。")
        )
    )
    parts.append("</section>")

    parts.append(h3("来源（X 公开讨论，非厂商报价）"))
    parts.append('<section style="padding:0 10px;">')
    parts.append(
        table(
            ["主题", "链接"],
            [
                ["全量部署成本图", "x.com/songexp/status/2081236228461265284"],
                ["64×H200 清单", "x.com/hppzyy/status/2081062901826433511"],
                ["1.4TB／芯片门槛", "x.com/Fferr16/status/2081236822747652440"],
                ["8×H100 仅 load", "x.com/StatsWire/status/2081236091802358174"],
                ["$1M＋ 硬件", "x.com/ConstraintEdge/status/2079712604050649330"],
                ["$11.7M ＋ $154k／月", "x.com/MrCollison/status/2081047199522115690"],
                ["自托管节省 10%–25%＋", "x.com/cline/status/2079301605179191716"],
                ["个人自托管不现实", "x.com/haider1/status/2078473575250698411"],
            ],
        )
    )
    parts.append(
        p(leaf("数字随行情与配置剧烈波动；本文只做量级对齐，不作采购依据。正式立项请以实测 profiling、厂商 BOM 与机房勘测为准。"), mb=12)
    )
    parts.append(p(leaf("ziikoo 研究院 · 大模型落地账本"), mb=28))
    parts.append("</section>")

    parts.append(
        '''
<section style="padding:0 10px;">
  <section style="text-align:center;margin:0 0 36px;">
    <section style="display:flex;align-items:center;justify-content:center;">
      <span style="height:1px;width:48px;background:#E4E4E7;margin-right:16px;"><span leaf=""><br></span></span>
      <span style="font-size:10px;color:#A1A1AA;letter-spacing:4px;font-weight:500;"><span leaf="">END</span></span>
      <span style="height:1px;width:48px;background:#E4E4E7;margin-left:16px;"><span leaf=""><br></span></span>
    </section>
  </section>
</section>
<section style="padding:0 10px 24px;">
  <section style="border-top:1px solid #E4E4E7;padding-top:28px;">
    <p style="margin-bottom:16px;font-size:16px;line-height:1.75;color:#52525B;text-align:justify;">
      <span leaf="">我是 ziikoo 研究院，关注 AI 落地账本与工程实践。</span>
    </p>
    <p style="margin-bottom:0;font-size:16px;line-height:1.75;color:#52525B;text-align:justify;">
      <span leaf="">如果你觉得今天这篇有收获，欢迎</span>
      <strong style="color:#27272A;"><span leaf="">点赞、在看、转发</span></strong>
      <span leaf="">三连，我们下篇见。</span>
    </p>
  </section>
</section>
'''
    )
    parts.append("</section>")

    out_path = OUT / "article_排版_石墨极简风(graphite-minimal).html"
    out_path.write_text("\n".join(parts), encoding="utf-8")
    print("wrote", out_path, "chars", len(out_path.read_text(encoding="utf-8")))


if __name__ == "__main__":
    main()
