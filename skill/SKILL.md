---
name: batch-tech-company-assessment
description: 在Codex中批量导入科创企业或项目名称及同一行大赛现场自由笔记，逐家完成主体映射、六轮公开深检和跨列事实提取，并由同一事实记录生成11类企业信息Excel、ima当前事实底稿及1—2页企业初评报告；也支持导入分支行拜访记录或企业材料后同步更新三类成果。适用于“导入企业名单后一键检索”“交付三件成果”“继续上次批次”“拜访后更新Excel/知识库/报告”等任务。
---

# 科创企业批量检索与初评

## 开始前

1. 解析项目根目录：优先读取环境变量`TECH_COMPANY_AGENT_ROOT`；否则从当前工作区向下或向上定位同时包含`scripts`、`config`和`schemas`的仓库目录。仍未找到时提醒用户运行仓库中的`install.ps1`或打开克隆后的仓库，不得使用开发者本机绝对路径。
2. 在Codex中完整执行`tech-competition-company-research`技能，写Excel时同时执行`Spreadsheets`技能；在WorkBuddy或其他Agent中完整读取本Skill及references，并使用其可用的网页搜索/浏览器。默认不用Wind，也不要求单独OpenAI API。
3. 读取`config/deep-research-playbook.json`。每家企业均须完成六轮深检，不得依赖测试期旧Excel或历史深检版才能达标。
4. 新建或续跑批次时阅读[公开检索与失败恢复](references/research-and-recovery.md)；生成成果或评级时阅读[成果、评级与报告](references/outputs-rating-and-report.md)；同步ima或整理交接包时阅读[ima与交接](references/ima-and-handoff.md)。
5. 统一事实记录是Excel、ima底稿和初评报告的唯一生成输入。旧Excel、旧报告和旧知识库只能作为检索锚点或回归测试，不能反向覆盖当前事实记录。

## 输入与入口

- 新名单：企业/项目名称与大赛现场自由笔记必须按Excel同一行绑定后一起导入。现场笔记是首批高价值材料，不是后续增量或“企业交流记录”。空白笔记行要列出，但不阻止对该企业公开检索。
- 用户说“继续”：读取`runs/latest-run.txt`，从未完成状态续跑，不重建已完成企业。
- 后续材料：仅将分支行拜访记录、企业证明材料或明确说明为补交的现场笔记作为增量；保留原文并区分现场陈述、现场观察、内部评价和公开确认。
- 企查查预检：先把已映射法律主体与本批企查查导出及`/firm/`链接逐一核对。漏导出时立即列出企业名提醒用户；项目尚未映射法律主体时先标`mapping_blocked`，不得误报漏导出。

## 执行

1. 创建批次：
   `node scripts/start-batch.mjs --input "<企业名称与现场笔记文件>" --name "<批次名>" --require-onsite-notes`
   非Codex环境或没有`@oai/artifact-tool`时改用：
   `python scripts/start_batch.py --input "<企业名称与现场笔记文件>" --name "<批次名>" --require-onsite-notes`
   企业较多时建立完整批次，默认每5家一波推进；批量只改变调度，不降低逐家深检深度。
2. 对每家企业：
   - 原样保存现场笔记，再拆为最小事实单元；把人名、型号、客户、投资方、轮次、资质、专利、量产及经营指标加入检索锚点。
   - 先闭合`项目/品牌→法律主体→负责人→曾用名/关联主体`。主体不明时停止迁移融资、客户、资质、知识产权和人员事实。
   - 严格登记`R1_subject_mapping`、`R2_channel_coverage`、`R3_field_deepening`、`R4_anchor_expansion`、`R5_gap_and_conflict`、`R6_cross_column_and_output`。
   - 每打开一个来源都做全字段抽取；项目负责人、发明人、标准起草人、客户新闻、产品型号和融资报道均触发跨列反查。
   - 对11列逐项写入`research_audit.field_checks`。有事实记`found+fact_ids`；无事实须有两条不同路径后才能记`searched_no_public_result`。
   - 清空`anchor_queue`、`weak_source_upgrade_queue`和`conflict_queue`；保留无法消解的冲突双方及边界。
   - 生成报告前写入`assessment.track`、`assessment.development_stage`和`assessment.conclusion_chains`。每条结论链必须包含客观结论、要素间关系、支撑事实ID及可能改变判断的关键条件；不得以11列非空数量或机械加分代替分析。
   - 大赛现场笔记默认作为高可信一手信息参与评级，不因缺少公开网页而降为普通弱线索。只有融资到账、订单/营收/回款、量产/流片、客户定点和关键性能等会显著改变结论的事项，才转化为拜访核验点；存在明确冲突时保留冲突。
3. 只有六轮、11列审计、现场笔记拆解与交叉核验、三类专项深化、跨列扫描和三队列全部完成，企业才能标`researched`；主体未闭合则标`mapping_blocked`。
4. 后续材料先转换为`visit-update.schema.json`，再运行：
   `node scripts/apply-visit-update.mjs --run "<批次目录>" --update "<审核后的增量.json>"`
   WorkBuddy或未安装Node.js的电脑改用：
   `python scripts/apply_visit_update.py --run "<批次目录>" --update "<审核后的增量.json>"`
   新事实替代旧事实时写`replaces_fact_id`；不能判断时保留冲突，不静默覆盖。

## 构建、质检与交付

1. 运行`node scripts/build-deliverables.mjs --run "<批次目录>"`，生成：
   - `deliverables/excel/*｜企业信息主表.xlsx`
   - `deliverables/ima-ready/*｜当前事实底稿.md`
   - `deliverables/reports/*｜企业初评报告.md`
   非Codex环境改用`python scripts/build_deliverables.py --run "<批次目录>"`生成同类成果。
2. 检查`review/validation.json`并预览Excel。任一企业未通过六轮、字段审计、投资机构逐家背景或来源边界时，整批正式交付阻断，不能先给一份看似完成的部分成品。
3. 有历史成果时做逐主张回归，分类为`publicly_reconfirmed`、`onsite_only`、`legacy_lead_unverified`、`conflicted`或`discarded_wrong_entity`；去向覆盖率必须为100%。历史成果不存在时仍执行同一深检门槛。
4. Markdown全部完成并质检后，用户要求Word才运行：
   `python scripts/build-word-report.py <报告.md> <报告.docx>`
   只交付DOCX，不交付PDF或内部渲染文件。
5. 本地质检通过后可自动新增上传并同步ima，无需逐次确认。遇到同名文件、删除/替换/移动、权限、DPAPI、登录、验证码、付费页或缺失企查查导出等需要用户动作的情况，必须立即说明具体对象和所需操作，不能静默降级。

## 不可违反的边界

- Excel仅保留企业/项目标识列和11类信息，不加入评级、来源、日志、风险项、社保/员工人数或说明页。
- 公司总机、客服、销售、招聘电话和公共邮箱不得进入“核心人员公开联系方式”。
- 合作、送样、定点、中标、量产和客户必须区分；融资、拟融资、老股转让、项目经费和中标额必须区分。
- 大赛信息只用于消歧，不重复写入科创资质。参保/员工人数可留在本地及ima作为团队规模背景，不进入Excel或报告，也不作为评级依据。
- ima实行一家企业一个当前事实底稿文件；不放完整初评、拜访重点或建联建议。Agent正式启用前不写`audience`、schema/file版本或版本记录。
- A/B/C/D是企业潜力与后续调研优先级，不是信用评级，也不构成授信、投资或合作结论。
- A类表示“最值得优先调研和介入”，不表示最成熟或风险最低。不同赛道按各自发展阶段里程碑评价；覆盖11类信息不等于平均使用11类信息。
