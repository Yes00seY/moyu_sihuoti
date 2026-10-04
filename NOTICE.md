# 数据来源与致谢 / Data Source & Attribution

本项目 `widget/go-tsumego.widget/data/` 下的 12,304 道死活题/手筋题，
转换自开源项目 **[sanderland/tsumego](https://github.com/sanderland/tsumego)**
（"Ten Thousand Tsumego" App 的源码仓库），该仓库以 MIT 协议开源，
其 `LICENSE` 文件明确声明授权覆盖"仓库中的内容"（即包含题目数据本身）。

> Copyright (c) 2020 Sander Land and/or other authors of the content in that
> repository.

该仓库的 `CONTRIBUTORS` 文件进一步说明，题目数据整理自：

- 原始死活题 / 手筋题作者（历代围棋书籍作者，如赵治勲、石田章、
  山田规三生、前田陈尔、李昌镐、吴清源、瀬越宪作、橋本宇太郎等人的著作）
- **TsumegoDojo**（协助收集整理了其中许多原始文件）

转换过程（`scripts/convert.py`）只做了格式转换（原始近似 SGF 的 JSON
格式 → 本项目使用的紧凑坐标格式）和质量过滤（剔除了原作者自己标注
"Backup solution detector used, solution may be incorrect."、即程序自动
猜测且不保证正确的约 336 道题），没有改动任何题目内容或正解。

按照 MIT 协议的要求，使用、修改、再分发这份数据时，请保留本文件和
`LICENSE` 中的版权声明。

---

If you redistribute or modify the data in `widget/go-tsumego.widget/data/`,
please keep this attribution and the MIT license notice from
[sanderland/tsumego](https://github.com/sanderland/tsumego), the upstream
source these problems were converted from.
