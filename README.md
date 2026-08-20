# 科创企业批量检索与初评Agent

> 本仓库将GPT/Codex与WorkBuddy的Skill分开维护。WorkBuddy同事请先阅读：[下载与首次使用](docs/下载与首次使用.md)和[WorkBuddy使用说明书](docs/WorkBuddy使用说明.md)。

输入企业/项目名单和大赛现场自由笔记（支持同一文件或分开上传并按名称匹配），由AI Agent完成主体映射和公开深检，再从同一事实记录生成四类成果：

1. 企业信息Excel（企业名称＋11类信息）；
2. ima当前事实底稿（一家企业一条可编辑笔记，保留完整事实与证据边界）；
3. 1—2页企业初评报告（按赛道和阶段建立“事实—关系—结论链”）；
4. 模板化推进意见（在初评分析完成后提炼生成，不机械复制Excel或报告）。

本仓库只包含工具、Skill、配置模板和数据结构，不包含企业名单、现场笔记、历史搜索结果、ima知识库ID、API Key或本机凭据。

## 支持环境

- **GPT/Codex**：使用`skills/gpt-codex`，运行`install.ps1`安装，可调用仓库内Node脚本和Codex自带表格运行环境。
- **WorkBuddy**：导入`packages/workbuddy-skill.zip`，使用Python入口、官方企查查连接器及可用的网页搜索/浏览器。
- Windows PowerShell 5.1或更高版本（ima同步）；Python 3.10或更高版本。

## 一、下载与安装

```powershell
git clone <仓库地址>
cd tech-company-assessment-agent
python -m pip install -r requirements.txt
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装完成后重启Codex或终端。WorkBuddy单独导入`packages/workbuddy-skill.zip`，不要导入GPT/Codex版。

## 二、输入文件

企业名单Excel或CSV至少包含名称列。现场笔记可以放在名单文件同一行，也可以单独上传一个包含“匹配名称列＋笔记列”的Excel/CSV：

- `企业名称`、`企业/项目名称`或`项目名称`；
- `大赛现场自由笔记`、`现场笔记`、`现场自由笔记`、`现场记录`或`自由笔记`。

分开上传时，系统按企业/项目名称匹配，并输出无法匹配、重名冲突和缺失笔记；不会自动猜测对应关系。不要在输入文件中放入API Key、账号密码或不必要的个人敏感信息。

## 三、新建批次

通用Python入口：

```powershell
python scripts/start_batch.py --input "企业名单.xlsx" --name "批次名称" --require-onsite-notes
```

名单和现场笔记分开时：

```powershell
python scripts/start_batch.py --input "企业名单.xlsx" --notes "现场笔记.xlsx" --name "批次名称" --require-onsite-notes
```

命令会生成`runs/<批次>/manifest.json`和逐企业事实记录。随后对Agent下达：

> 完整阅读当前平台Skill及其references，处理刚创建的批次。逐家完成六轮公开深检、11列审计、赛道和发展阶段判断，以及事实—关系—结论链；不要跳过现场笔记。

## 四、构建四类成果

事实记录完成后运行：

```powershell
python scripts/build_deliverables.py --run "runs/<批次目录>"
```

成果位于该批次的`deliverables`目录。需要Word时再运行：

```powershell
python scripts/build-word-report.py "企业初评报告.md" "企业初评报告.docx"
```

## 五、更新拜访信息

将分支行拜访记录或企业证明材料拆成`schemas/visit-update.schema.json`格式，审核后运行：

```powershell
node scripts/apply-visit-update.mjs --run "runs/<批次目录>" --update "拜访增量.json"
```

WorkBuddy或未安装Node.js的电脑使用Python入口：

```powershell
python scripts/apply_visit_update.py --run "runs/<批次目录>" --update "拜访增量.json"
```

之后重新构建四类成果。新事实与旧事实冲突时不得静默覆盖。

## 六、连接ima

WorkBuddy默认使用ima连接器直接授权并上传`deliverables/ima-ready`中的底稿；先试传一家并检索验证，再上传其余文件。无需向同事分发API Key或Client ID。

以下本地OpenAPI脚本仅作为没有可用ima连接器时的备用方案：

1. 复制`config/ima.example.json`为`config/ima.json`，仅填写自己的知识库ID；
2. 在自己的Windows账户运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-ima-credentials.ps1
```

3. 本地质检通过后同步：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-approved-run-to-ima.ps1 -RunPath "runs/<批次目录>" -ApprovedBy "操作人"
```

凭据使用Windows DPAPI加密，不能复制到另一台电脑或另一个Windows账户。出现同名底稿时，先在ima界面删除或替换旧文件，再重新同步。

## 七、安全边界

- 不提交`.secure`、`config/ima.json`、企业材料、现场笔记、搜索底稿、运行日志和交付成果；
- 不把公司总机或公共邮箱当作核心人员联系方式；
- 不把合作、送样、定点、中标、量产和客户混为一类；
- A/B/C/D表示潜力和调研优先级，不是信用评级；
- 报告仅供初步筛选与拜访准备，不构成授信、投资或合作结论。
