# WorkBuddy使用科创企业尽调工作流说明书

## 一、这套工具能做什么

将企业/项目名单和大赛现场自由笔记交给WorkBuddy后，WorkBuddy按照统一检索口径逐家开展公开信息深检，并从同一份事实记录生成三类成果。名单和现场笔记既可以放在同一个Excel，也可以作为两个文件分别上传：

1. 11类企业信息Excel；
2. 一家企业一个文件的ima当前事实底稿；
3. 1—2页企业初评报告。

后续收到分支行拜访记录或企业材料时，可在原批次上更新事实记录，再同步重建三类成果。

这不是单纯的Excel填空工具。公开搜索、主体核验、证据登记、跨列补充和评价推理由WorkBuddy中的模型完成；Python脚本负责建立批次、检查结构并生成交付文件。

## 二、首次使用前准备

### （一）下载并解压工具

无需GitHub账号，直接下载：

<https://github.com/SHRCBChen/tech-company-assessment-agent/archive/refs/heads/main.zip>

将压缩包解压到固定位置，例如：

`D:\企业尽调Agent`

不要放在微信临时目录，也不要在每次任务后移动整个文件夹。

### （二）安装Python依赖

电脑需安装Python 3.10或更高版本。在工具文件夹空白处打开PowerShell，运行：

```powershell
python -m pip install -r requirements.txt
```

若提示“找不到python”，请让安装Python，并在安装时勾选“Add Python to PATH”。

### （三）将Skill导入WorkBuddy

在WorkBuddy中进入：

`技能 → 添加技能 → 上传技能`

选择仓库中的：

`workbuddy\batch-tech-company-assessment-workbuddy-skill.zip`

导入后确认该技能处于启用状态。WorkBuddy官方说明支持通过本地技能包导入Skill；如当前版本界面名称略有变化，可在“技能”页面查找“添加技能”或“上传技能”。

### （四）确认公开检索能力

新建一个测试任务，询问WorkBuddy：

> 请搜索一家公开企业的官网、政府公示和专利信息，并给出可打开的来源链接。

能返回并打开来源链接，说明公开检索可用。如果只能基于模型记忆回答，需在WorkBuddy中配置单位允许使用的网页搜索或浏览器能力。WorkBuddy官方支持通过MCP连接外部工具，入口通常位于“插件/MCP服务器”。

不要让模型在没有真实网页来源的情况下假装完成公开深检。

## 三、准备企业名单和现场笔记

支持以下两种方式。

### （一）名单和笔记分开上传（更常见）

企业名单文件至少包含一列：

| 企业/项目名称 |
|---|
| 示例项目A |

现场笔记可以是下列任一种形式，也可一次上传多个附件：

1. **Excel/CSV**：至少包含用于匹配的名称列和笔记列：

| 企业/项目名称 | 大赛现场自由笔记 |
|---|---|
| 示例项目A | 现场记录的团队、产品、客户、融资、经营预测及评委意见 |

2. **Word（.docx）自由笔记**：每家企业以“企业/项目名称”或唯一的简称作为一个小标题，下面连续记录该企业内容。例如：

```text
蓝韵净芯微电子（上海）有限公司
音频SoC芯片……已向Harman出货……

基琳微
4D毫米波雷达芯片……
```

3. **图片/PDF**：直接上传拍照笔记、截图或扫描件。WorkBuddy先识别文字、再按其中出现的企业名称匹配；不能仅凭文件名猜测归属。识别不清、出现多家企业或未匹配的内容会单独列为待确认项。

启动命令：

```powershell
python scripts/start_batch.py --input "企业名单.xlsx" --notes "现场笔记.docx" --notes "现场照片1.jpg" --name "批次名称" --require-onsite-notes
```

### （二）名单和笔记放在同一个Excel

同一个Excel中保留“企业/项目名称”和“大赛现场自由笔记”两列，且两者位于同一行。启动时不传`--notes`：

```powershell
python scripts/start_batch.py --input "企业名单及现场笔记.xlsx" --name "批次名称" --require-onsite-notes
```

注意事项：

1. Excel/CSV笔记必须有可匹配的企业/项目名称；Word应使用企业名称或唯一简称分段；图片/PDF由WorkBuddy视觉识别后匹配；
2. 系统按规范化名称匹配，无法匹配的笔记、重名冲突和缺失笔记会单独列出，不会自动猜测；
3. 一家企业可以没有现场笔记，但不可把另一家企业的笔记错配过来；
4. 现场笔记保留原文，不要先让其他模型概括；
5. 不要在Excel中写入账号密码、API Key、身份证号等敏感信息；
6. 项目名不等于公司名时保留项目原名；若名单和笔记使用不同名称，应在Excel笔记中增加与名单完全一致的匹配名称列。Word/图片中无法确定归属时，Agent必须列出待确认项，不得猜测。

建议将文件复制到工具目录下的`inbox`文件夹；没有该文件夹时可自行新建。

## 四、在WorkBuddy中启动首次任务

### （一）选择工作目录

新建任务时，点击输入框附近的“选择文件夹”，选择整个工具仓库根目录，即同时包含以下文件夹的目录：

- `skill`
- `scripts`
- `config`
- `schemas`

不要只选择企业名单所在文件夹，否则WorkBuddy无法找到Skill、脚本和数据结构。

### （二）上传或引用输入文件

把企业名单和现场笔记文件一起拖入任务输入框，或使用`@`分别引用两个文件。若两者已经在同一个Excel中，只需上传该Excel。

### （三）粘贴启动指令

将`workbuddy\首次任务提示词.txt`中的内容粘贴到任务中，并把文件名、批次名替换成实际内容。

推荐指令：

```text
请完整读取并严格执行 skill/SKILL.md 及其 references，使用WorkBuddy可用的真实网页搜索/浏览器处理“<企业名单文件.xlsx>”及全部现场笔记附件（Excel/CSV、Word .docx、图片或PDF均可）。

先用 python scripts/start_batch.py --input "<企业名单文件.xlsx>" --notes "<现场笔记附件1>" --notes "<现场笔记附件2>" --name "<批次名称>" --require-onsite-notes 建立批次。对Word按企业标题拆分；对图片/PDF先视觉识别原文，再按文字中的企业/项目名称匹配。检查并报告无法匹配的笔记、重名冲突、Word未绑定段落、图片/PDF待识别材料和缺失笔记，不得仅凭文件名或上下文猜测绑定；随后逐家完成主体映射、六轮公开深检、11类字段审计、现场笔记拆解与交叉核验、投资机构逐家背景核验，以及事实—关系—结论链。所有事实、来源、审计状态和评价依据写入本批次records，不要直接从Excel拼报告。

完成全部企业后运行 python scripts/build_deliverables.py 生成Excel、ima当前事实底稿和Markdown初评报告。遇到登录、验证码、企查查漏导出、主体无法映射或付费页面时立即告诉我具体企业和所需动作，不要降低检索标准，也不要虚构内容。
```

### （四）执行过程中你需要做什么

WorkBuddy可自行继续处理的情况，不需要逐步确认。出现下列情况时需要人工介入：

- 企查查等网站需要登录；
- 企查查批量导出漏了已映射企业；
- 页面出现验证码；
- 项目名称无法对应唯一法律主体；
- 同一关键事实出现相互矛盾的可靠来源；
- ima存在同名旧文件，需要删除或替换。

当WorkBuddy只搜索少量网页就准备交付时，应回复：

> 继续执行Skill规定的六轮深检和11类字段审计；未找到的信息必须完成两条不同路径检索，不能因公开信息少而提前结束。

## 五、如何判断检索是否真正完成

不要只看Excel是否填满。完成标准包括：

1. 项目、品牌、法律主体及负责人映射清楚；
2. 每家企业完成六轮检索；
3. 11类字段逐项登记“已找到”或“两条路径检索后无公开结果”；
4. 现场笔记已拆为事实并与公开信息交叉核验；
5. 融资金额、轮次、投资方及投资机构背景已分开核验；
6. 客户、合作、送样、定点、中标和量产没有混写；
7. 评级按赛道和发展阶段形成至少三条事实—关系—结论链；
8. `build_deliverables.py`没有返回`BLOCKED`。

如果构建脚本返回`BLOCKED`，说明事实记录或评价链未达到交付门槛，应让WorkBuddy根据错误信息继续补检，不能手工删除检查项绕过。

## 六、三类成果在哪里

当前批次路径记录在：

`runs\latest-run.txt`

该批次下的成果位于：

| 成果 | 位置 |
|---|---|
| 11类企业信息Excel | `deliverables\excel` |
| ima当前事实底稿 | `deliverables\ima-ready` |
| 企业初评Markdown报告 | `deliverables\reports` |
| 逐家事实记录 | `records` |

`records`是三类成果的统一生成源，不要只修改交付Excel。否则下次重建时，Excel中的手工修改会丢失。

需要Word报告时运行：

```powershell
python scripts/build-word-report.py "报告.md" "报告.docx"
```

## 七、拜访后如何更新

把分支行拜访记录或企业材料放入当前任务，并使用`workbuddy\拜访更新提示词.txt`。

推荐指令：

```text
请读取 skill/SKILL.md、schemas/visit-update.schema.json 和本批次现有records。将“<拜访记录或企业材料>”保留原文，区分企业陈述、现场观察、内部评价和证明材料，生成审核用增量JSON。不要静默覆盖冲突事实；新事实替代旧事实时写明replaces_fact_id。

审核无误后，使用 python scripts/apply_visit_update.py 写入原批次，再运行 python scripts/build_deliverables.py 重建Excel、ima底稿和报告。报告评价必须根据更新后的客观事实重新判断，不沿用旧结论。
```

执行命令示例：

```powershell
python scripts/apply_visit_update.py --run "runs\<批次目录>" --update "拜访增量.json"
python scripts/build_deliverables.py --run "runs\<批次目录>"
```

## 八、通过WorkBuddy连接器同步到ima

### （一）默认方式：使用ima连接器

WorkBuddy能够通过连接器访问ima时，应优先使用连接器，不要求同事配置API Key、Client ID、DPAPI或本地上传脚本：

1. 在WorkBuddy左侧进入“连接器”；
2. 找到ima连接器并点击添加；若当前版本未显示独立ima卡片，则通过“自定义连接器/MCP”接入单位已批准的ima连接；
3. 按页面提示登录并授权，只授予完成知识库读取和上传所需的权限；
4. 选择“大赛企业知识库”，确认连接状态为已连接/启用；
5. 先选择一家企业的`deliverables\ima-ready\*｜当前事实底稿.md`试传；
6. 在ima中用企业全称和一条关键事实检索，确认文件名、中文内容和索引正常；
7. 验证通过后，再让WorkBuddy把本批次其余`ima-ready`文件上传到同一知识库。

推荐指令：

```text
请使用已连接的ima连接器，将当前批次deliverables/ima-ready目录中的企业当前事实底稿上传到“大赛企业知识库”。先上传一家并通过企业全称和关键事实检索验证；验证成功后再上传其余文件。遇到同名文件、覆盖、替换、删除或权限问题时立即告诉我具体企业，不要自行删除旧文件。
```

### （二）备用方式：本地OpenAPI脚本

仅当所在WorkBuddy版本没有可用ima连接器，并且单位允许使用OpenAPI时，才按仓库README中的脚本方式配置。API Key和Client ID不得写入Excel、聊天或GitHub。换电脑后需重新设置本机凭据。

## 九、最常见的错误

### （一）WorkBuddy只生成了空白批次

原因：只运行了`start_batch.py`，没有让Agent逐家检索并写入records。

处理：重新发送首次任务提示词，并明确“继续检索直到全部records通过构建检查”。

### （二）报告像Excel内容拼接

原因：没有形成事实—关系—结论链。

处理：要求WorkBuddy检查`assessment.track`、`development_stage`和`conclusion_chains`，按赛道阶段重新生成。

### （三）公开信息很少就提前结束

原因：WorkBuddy没有执行失败恢复路径。

处理：要求完整读取`skill/references/research-and-recovery.md`，对空白字段至少执行两条不同检索路径。

### （四）中文显示乱码

处理：Excel使用`.xlsx`格式；CSV保存为UTF-8 BOM；PowerShell脚本保持UTF-8编码；不要用旧版记事本覆盖脚本。

### （五）WorkBuddy连接器无法访问ima

处理：先确认ima连接器处于已连接和启用状态、当前账号有“大赛企业知识库”权限，并在连接器管理页重新授权。若使用的是备用OpenAPI脚本，换电脑后再重新运行`setup-ima-credentials.ps1`，不要复制`.secure`文件夹。

## 十、安全与使用边界

- 仓库可以公开下载，但企业名单、现场笔记、事实记录、报告和ima凭据不能提交到公开仓库；
- 每次处理企业数据时使用本地工作目录，不把运行目录自动同步到个人网盘；
- 公司总机、客服、销售、招聘电话和公共邮箱不能写入“核心人员公开联系方式”；
- A/B/C/D表示企业潜力及后续调研优先级，不是信用评级；
- 初评报告仅供初步筛选和拜访准备，不构成授信、投资或合作结论。

## 十一、WorkBuddy官方参考

- [创建任务、选择工作目录及上传文件](https://www.workbuddy.ai/docs/zh/workbuddy/Create-Task)
- [安装和管理本地Skill](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market)
- [通过MCP连接外部工具](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)
- [连接器管理与自定义连接器](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector)
