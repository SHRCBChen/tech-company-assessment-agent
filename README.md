# 科创企业批量检索与初评Agent

输入企业/项目名单及同一行大赛现场自由笔记，由AI Agent完成主体映射和公开深检，再从同一事实记录生成三类成果：

1. 企业信息Excel（企业名称＋11类信息）；
2. ima当前事实底稿（一家企业一个文件，保留完整事实与证据边界）；
3. 1—2页企业初评报告（按赛道和阶段建立“事实—关系—结论链”）。

本仓库只包含工具、Skill、配置模板和数据结构，不包含企业名单、现场笔记、历史搜索结果、ima知识库ID、API Key或本机凭据。

## 支持环境

- **Codex**：运行`install.ps1`安装Skill，可使用仓库内Node脚本和Codex自带表格运行环境。
- **WorkBuddy或其他可执行本地脚本的Agent**：让Agent完整阅读`skill/SKILL.md`，使用Python入口处理Excel和构建成果；公开搜索能力由所选模型/搜索工具提供。
- Windows PowerShell 5.1或更高版本（ima同步）；Python 3.10或更高版本。

## 一、下载与安装

```powershell
git clone <仓库地址>
cd tech-company-assessment-agent
python -m pip install -r requirements.txt
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装完成后重启Codex或终端。WorkBuddy无需安装Codex Skill，但必须在任务开始时读取`skill/SKILL.md`及其引用文件。

## 二、输入文件

Excel或CSV至少包含：

- `企业名称`、`企业/项目名称`或`项目名称`；
- `大赛现场自由笔记`、`现场笔记`、`现场自由笔记`、`现场记录`或`自由笔记`。

企业名称和现场笔记必须在同一行。不要在输入文件中放入API Key、账号密码或不必要的个人敏感信息。

## 三、新建批次

通用Python入口：

```powershell
python scripts/start_batch.py --input "企业名单.xlsx" --name "批次名称" --require-onsite-notes
```

命令会生成`runs/<批次>/manifest.json`和逐企业事实记录。随后对Agent下达：

> 完整阅读skill/SKILL.md，处理刚创建的批次。逐家完成六轮公开深检、11列审计、赛道和发展阶段判断，以及事实—关系—结论链；不要跳过现场笔记。

## 四、构建三类成果

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

之后重新构建三类成果。新事实与旧事实冲突时不得静默覆盖。

## 六、连接ima

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

