# WorldCraft：程序化城市与聚落生成研究资料

调研日期：2026-11-09。面向当前 V0.6。本文是研究资料与算法选型建议，不表示已经实现、复现或完成性能验证。

资料以作者论文、SideFX/Epic 官方文档和作者代码仓库为主。论文年份按正文或出版信息记录，不使用搜索引擎的抓取时间推断年份。网页与论文文本已查阅；本轮未下载运行 HIP/HDA、未完整观看课程视频、未复现第三方仓库。

## 1. 对项目缺口的判断

WorldCraft 已有确定性随机数、道路拓扑、凸多边形裁切、复合区域表示和几何不变量检查。这些是有效的算法基础。当前更欠缺的是**解释城市和聚落形态如何形成的生成模型**，以及与真实形态对照的评价方法。

本次重新阅读代码确认：

| 当前入口 | 已有做法 | 需要进一步研究的问题 |
|---|---|---|
| `src/polygonal.mjs → makeRoadAxes` | 规则路网与斜向道路 | 地形、水岸、多个中心如何共同决定道路方向与层级 |
| `src/road-network.mjs → sampleRoadCurve` | 作者设置二次 Bézier 中点偏移 | 曲线可编辑，但走向没有由地形成本或服务需求求解 |
| `src/polygonal.mjs → assignParcels` | 在 X/Z 两轴尝试条带裁切，选出全部临路的方案，否则保留整块 | 街道朝向、临街面宽、进深、尖角、内部庭院如何控制 |
| `src/polygonal.mjs → distributeUse` | 随机值、距中心距离和阈值分配用途 | 用地与可达性、邻里相容性、需求和服务覆盖的联系 |
| `src/polygonal.mjs → createBuildings` | 取可退界的最大凸子单元，缩放建筑基底并赋予高度/类型 | 沿街排列、院落、连排、入口朝向、坡地基础和建筑语法 |
| `src/spatial.mjs → EXTENSION_SLOTS` | 地形与水系接口预留 | 使环境在道路与聚落生成之前实际参与决策 |
| `src/region.mjs` | 从已铺砌的凸单元恢复外环、内洞 | 这是区域表达和聚合算法，与街区设计、地块布局算法分工不同 |

几何合法只是第一层。形态可信还需要尺度分布、临街关系、道路等级与聚落中心等约束；若要预测真实发展，则还需要数据校准和独立的行为模型。本文主要针对可控的视觉建模。

## 2. 最应精读的七篇基础论文

### P01 · 城市生成的基础框架

**Parish & Müller，2001，Procedural Modeling of Cities，SIGGRAPH。**

[作者机构 PDF](https://cgl.ethz.ch/Downloads/Publications/Papers/2001/p_Par01.pdf)

- 方法：扩展 L-system，以全局目标提出候选道路，再由局部约束修正或拒绝；人口和地理图参与生成。
- 借鉴点：把道路“候选生成”和“约束接受”分开，便于记录每条路的生成原因。
- WorldCraft 对应：替换或扩展 `makeRoadAxes` 的候选路段来源，保留下游裁切和验证。
- 边界：经典模型有风格与规则设定，不能直接当作真实城市历史预测器。

### P02 · 可控城市路网：张量场

**Chen、Esch、Wonka、Müller、Zhang，2008，Interactive Procedural Street Modeling，SIGGRAPH。**

[作者 PDF](https://peterwonka.net/Publications/pdfs/2008.SG.Chen.InteractiveProceduralStreetModeling.pdf)

- 方法：设计张量场，并沿主、次特征方向追踪道路；结合全局场编辑与局部图编辑。
- 借鉴点：规则网格、放射中心、水岸边界可以变成可混合的方向控制，而不必逐段手画。
- WorldCraft 对应：在道路拓扑之前增加 field 数据；生成结果仍为节点/路段图。
- 边界：方向场不自动保证合法路口、合理街区或连通性，必须配合追踪终止、吸附、交叉切分与网络检查。

### P03 · 最贴近“程序化聚落”的研究

**Emilien、Bernhardt、Peytavie、Cani、Galin，2012，Procedural Generation of Villages on Arbitrary Terrains，The Visual Computer 28:809–818。**

[作者 PDF](https://perso.liris.cnrs.fr/egalin/Articles/2012-villages.pdf)

- 方法：按环境兴趣图与生长情景逐步选址；新增建筑与道路扩展交替进行；之后用各向异性扩张划地，并用开放形状语法生成适应坡地的住宅。
- 借鉴点：建筑和道路存在反馈，适合山地、滨水、农耕等稀疏聚落。
- WorldCraft 对应：作为独立的 village 生成模式，产生聚落种子和路网，再接地块与建筑阶段。
- 边界：论文中的类型与偏好设定有特定文化和场景背景，需要重新设定本项目的建筑类型与参数。

### P04 · 顺应地形的道路选线

**Galin、Peytavie、Maréchal、Guérin，2010，Procedural Generation of Roads，Computer Graphics Forum。**

[作者 PDF](https://perso.liris.cnrs.fr/egalin/Articles/2010-roads.pdf) · [出版页](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-8659.2009.01612.x)

- 方法：加权各向异性最短路径，成本考虑位置和方向等因素；离散搜索后生成道路几何。
- 借鉴点：让连接路线权衡坡度、长度与障碍，而非只把二维曲线投影到地面。
- WorldCraft 对应：地形存在后，用于村落间连接或支路接入。
- 边界：最短路径解决给定端点的连接问题，本身不决定整张城市路网的结构。

### P05 · 专业地块划分

**Vanegas、Kelly、Weber、Halatsch、Aliaga、Müller，2012，Procedural Generation of Parcels in Urban Modeling，Eurographics / CGF。**

[作者机构 PDF](https://www.cs.purdue.edu/cgvlab/www/resources/papers/Vanegas-Eurographics-2012-Procedural_Generation_of_Parcels_in_Urban_Modeling.pdf) · [作者项目页](https://twak.org/project/parcels/)

- 方法：直骨架形成沿街条带；有向包围盒（OBB）递归分割支持另一类布局；控制面积、面宽与不规则程度，并讨论编辑后的地块持久性。
- 借鉴点：将 frontage 视为分割依据；允许具有明确语义的中心庭院，而非所有区域都强行作为独立临街建设地块。
- WorldCraft 对应：升级 `assignParcels`，并为道路编辑前后的地块建立匹配关系。
- 边界：普通 OBB 裁切不会天然保证临街；直骨架在退化几何和孔洞下需要鲁棒实现。

### P06 · 从体块到建筑

**Müller、Wonka、Haegler、Ulmer、Van Gool，2006，Procedural Modeling of Buildings，SIGGRAPH。**

[作者 PDF](https://www.peterwonka.net/Publications/pdfs/2006.SG.Mueller.ProceduralModelingOfBuildings.final.pdf)

- 方法：CGA shape，从体量分解到立面、屋顶和细节，结合遮挡与对齐关系。
- 借鉴点：先定义建筑类型与局部坐标，再执行可追踪规则；窗、门、楼层与屋顶属于同一规则体系。
- WorldCraft 对应：把单基底拉伸升级为 massing → facade → modules 的分层生成。
- 边界：建筑细化不负责聚落选址；完整 CGA 实现范围很大，可先只实现少量明确的规则操作。

### P07 · 功能与几何的反馈

**Vanegas、Aliaga、Beneš、Waddell，2009，Interactive Design of Urban Spaces Using Geometrical and Behavioral Modeling，ACM TOG。**

[作者 PDF](https://cs.purdue.edu/homes/bbenes/papers/Vanegas09ToG.pdf) · [实验室出版页](https://cs.purdue.edu/cgvlab/www/publications/Vanegas09ToG/)

- 方法：将行为需求和城市几何放入迭代反馈，使编辑能引起人口、就业与空间布局的联动。
- 借鉴点：用地不只由空间随机数决定，还可以受需求和可达性影响。
- WorldCraft 对应：未来引入小规模需求与容量模型。
- 边界：本项目尚无校准数据，初期宜称“设计规则与情景生成”，不宣称预测城市发展。

## 3. Houdini 官方资料：分别学什么

### H01 · Skylark：聚落建筑的视觉与工具范例

[Project Skylark](https://www.sidefx.com/learn-main-menu/tech-demos/project-skylark/) · [Building Generator 教程](https://www.sidefx.com/tutorials/project-skylark-building-generator/)

官方展示风格化住宅、植物和桥梁 HDA，并提供项目文件入口。Building Generator 接受用户 block-out，再自动布置窗户和梁。

适合学习：建筑模块约束、非规则体量细化、艺术控制与工具封装。公开介绍没有给出完整的村落选址与路网生长模型，不能仅凭最终场景推定存在一键聚落模拟算法。

### H02 · Epic City Sample：城市数据到资产和运行时

[官方 Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/city-sample-quick-start-for-generating-a-city-and-freeway-in-unreal-engine-5)

展示将 Houdini 生成数据送入 UE，通过规则处理器组装城市，并连接交通 Zone Graph 与 HLOD。

适合学习：布局事实数据、实例点与渲染资产之间的合同。其示例工作流有特定版本背景，网页仍注明开发采用 Houdini 18.5.532；不应假设现有最新版安装后可直接复现。

### H03 · Titan：模块化建筑装配

[Project Titan Building Tool](https://www.sidefx.com/tutorials/project-titan-building-tool/)

Simon Verstraete 的官方教程，页面标注 Houdini 19、2022 年。以 box 体量为输入，生成模块化建筑和适配屋顶。

适合学习：体量分解、模块尺寸、转角、屋顶和实例化。它主要解决已有建筑体量如何细化。

### H04 · PDG：批处理和依赖调度

[H19.5 Foundations — Build a City with PDG](https://www.sidefx.com/tutorials/foundations-build-a-city-with-pdg/)

Robert Magee 的官方课程，2023 年。以城市图为起点，按街区创建工作项并分发建筑生成任务。

适合学习：依赖、缓存、批量变体与任务调度。PDG 负责组织计算，具体城市形态仍取决于任务内部的规则。

### H05 · 地块分割节点

[Labs Lot Subdivision 2.0](https://www.sidefx.com/docs/houdini/nodes/sop/labs--lot_subdivision-2.0.html)

官方参数包含切分对齐方式、最小尺寸、迭代数、不规则度和聚类。可作为递归分割实验基线；还需额外检查临路、入口和用地尺度。

### H06 · 直骨架节点

[Labs Straight Skeleton 2D](https://www.sidefx.com/docs/houdini/nodes/sop/labs--straight_skeleton_2D.html)

官方列出屋脊、道路/路径中心线等用途。适合对照 P05 学习骨架结构。节点产出的骨架仍需后续规则才能成为合适地块或屋顶。

### H07 · 环境分析节点

[Labs Terrain Analysis](https://www.sidefx.com/docs/houdini/nodes/sop/labs--terrain_analysis-1.0.html)

从 HeightField 生成成本与避让属性，提供坡度等分析输出。适合与 P03/P04 对照，把地形转换为决策数据。

## 4. 可读代码与几何实现

| 编号 | 一手来源 | 推荐用途 | 本轮核对与限制 |
|---|---|---|---|
| C01 | [ProbableTrain/MapGenerator](https://github.com/ProbableTrain/MapGenerator) · [使用说明](https://github.com/ProbableTrain/MapGenerator/blob/master/docs/usageguide.md) | TypeScript 张量场、分级道路与地图生成；对浏览器项目参考价值高 | README 和说明已读，未运行；仓库含 LGPL/GPL 授权文件，正式复用时应核对所用文件许可 |
| C02 | [kiryha/Houdini — Procedural City](https://github.com/kiryha/Houdini/wiki/procedural-city) | 建筑体量属性、JSON 风格规则、立面分段和资产组装 | Wiki 已读，未执行 HIP；不据此声称工程可直接复用或维护活跃 |
| C03 | [Esri/cityengine_for_houdini](https://github.com/Esri/cityengine_for_houdini) | 在 Houdini 中执行 CGA 规则的集成实例 | README 已读；源码许可与 SDK/二进制使用条件不同，不能视为可直接嵌入浏览器的免费运行时 |
| C04 | [CGAL 2D Straight Skeleton and Polygon Offsetting](https://doc.cgal.org/latest/Straight_skeleton_2/index.html) | 直骨架、带洞多边形与偏移轮廓的成熟参考 | 用户手册已读，未集成；C++/WASM 包装、包许可、数值鲁棒性和体积需要单独评估 |

CGAL 手册明确区分 straight skeleton、medial axis 和 Voronoi。三者相关，但不能把它们当成同一个几何算法。

## 5. 与自然语言入口相关的近期研究

### N01 · CityX（2024）

[CityX: Controllable Procedural Content Generation for Unbounded 3D Cities](https://arxiv.org/abs/2407.17572)

查阅范围：arXiv 摘要与版本信息。它将多模态条件转换成程序并协调 PCG 插件，包含视觉反馈。对 WorldCraft 的启发是先建立稳定的程序/工具接口，再考虑语言模型编排。未在本轮核验代码可用性或复现实验效果。

### N02 · CityGenAgent（2026）

[Imagine a City: CityGenAgent for Procedural 3D City Generation](https://arxiv.org/abs/2602.05362)

查阅范围：arXiv 摘要与版本信息；页面记录 2026-02 提交及修订。其 Block Program / Building Program 分层与受 Schema 约束的输出值得关注。训练与奖励优化有额外成本；本轮不将其作为已验证可直接接入的组件。

这两项放在前沿观察层。它们不能替代道路、地块与建筑的具体几何算法，也不构成完整复现承诺。

## 6. 从资料提炼的候选算法

以下接口、公式、流程与优先级均为面向 WorldCraft 的建议，不是论文原公式或已批准的实施设计。

### A. 环境适宜性与硬约束

增加可采样的 `height / slope / waterDistance / exclusion / accessibility` 场。区分固定场与每次生长后变化的场，避免把不可建设条件仅作为一个可被其他收益抵消的负权重。

示意选址评分：

```text
若水域、保护区或坡度超过类型上限：拒绝
否则 suitability(type, p)
  = terrainPreference + accessPreference + centerAttraction
    + neighborPreference - crowdingPenalty
```

各项应归一化，并允许不同建筑类型使用不同距离偏好。例如农舍和连排住宅不应具有相同的邻居间距。

### B. 城市道路方向场

```text
T(p) = Σ weight_i(p) · T_i(p)
候选方向 = T(p) 的主/次特征方向
追踪 → 距离约束 → 吸附/交叉切分 → 道路拓扑验证
```

注意特征向量正负号等价，应按上一追踪步保持符号连续；退化场需要终止或采用明确的回退方向。密度、等级和最小道路间距需另行控制，不能只靠积分方向。

### C. 村落增长与道路反馈

```text
读取地形、外部道路入口、生长情景
按建筑类型生成候选选址并作硬约束检查
根据适宜性接受候选
将新建筑接入道路，重新计算相关可达性
重复，直到达到情景目标或预算
最后划地，并生成适应坡地的建筑
```

与当前一次性流水线相比，这需要独立的布局生长阶段；不宜将“增加一个随机散点节点”当作完成了村落模型。

### D. 方向相关的道路成本

```text
cost(path) = Σ [lengthCost + gradeCost + turnCost + obstacleCost]
```

若转弯成本依赖前一段方向，搜索状态应包含进入方向；仅为每个格点保存一个距离不足以表达该成本。路径平滑后还需重新检查坡度、水域和净距，防止平滑越过障碍。

### E. 临街地块与建筑类型语法

优先尝试：按街道方向的 OBB 递归划分，并在每次切分时检查面宽、进深、面积与道路接入；复杂沿街条带再评估直骨架。对庭院、通道和建设地块使用不同语义，不必都套用相同临路不变量。

建筑规则先限定为三类：沿街连排、带院落独栋、坡地阶梯住宅。每类明确输入地块、入口边、朝向、层数和屋顶参数，再输出体量和模块实例。入口与道路、院落与地块必须保持可追踪关系。

## 7. Houdini 与浏览器项目如何结合

以下是研究后的三种选择，并非已确定的开发路线。

| 选择 | 收益 | 成本与限制 |
|---|---|---|
| 继续在 JS 中实现布局算法 | 保留离线、确定性和即时编辑，最贴合当前结构 | 鲁棒几何和复杂建筑模块需逐步建设 |
| 用 Houdini 制作对照原型与建筑资产，浏览器消费布局或资产数据 | 可快速验证视觉规则、利用 HDA，并保持网页交互 | 需要定义坐标、单位、ID、实例与材质合同；资产导入与复杂模型渲染当前尚未打通 |
| 将主要生成迁入 Houdini/Houdini Engine | 适合面向内容生产的复杂工具链 | 运行环境、部署、许可与交互延迟均需评估，改变现有单 HTML 交付方式 |

当前建议先保持 JS 布局内核，用 Houdini 作为建筑规则和几何结果的对照环境。是否迁移主生成器，需要根据最终产品是“浏览器设计工具”还是“离线内容生产工具”再决定。

## 8. 建议验证实验

| 实验 | 对照 | 需要观察的结果 |
|---|---|---|
| 路网形态 | 当前自动路网 vs 张量场路网；相同场地与规模 | 连通分量、路口度数、道路长度/方向分布、街区面积、生成耗时 |
| 地块质量 | 当前条带分割 vs 临街 OBB / 骨架法 | 临街覆盖、面宽和进深分布、狭长比、尖角、不可建比例、面积守恒 |
| 村落生长 | 一次性布置 vs 选址/道路反馈；相同建筑预算 | 坡度分布、接入距离、建筑间距、中心集聚、环境硬约束违反数 |
| 建筑布局 | 当前体块 vs 三类建筑规则 | 入口接路、边界退让、院落保留、屋顶/模块冲突及实例数量 |
| 编辑稳定性 | 小幅移动路口后重算 | 几何有效性、受影响范围、地块匹配率、自定义属性保留率 |

先保留现有确定性、铺砌、避让和回滚测试，再增加上述形态指标。保存固定参数、种子、布局 JSON 与俯视图，以真实地图或明确风格目标进行统计和视觉对照。没有参照数据时，不应只凭“更不规则”判断“更真实”。

## 9. 建议阅读和研究顺序

1. **P03 村落生成**：先理解道路与选址反馈，最接近本次需求。
2. **P02 + C01 张量场路网**：对照可读的浏览器代码，研究可控道路模式。
3. **P05 + H05/H06 地块划分**：补足临街尺度与地块形态控制。
4. **H01/H03 + P06 建筑生成**：从体量走向有建筑语言的规则资产。
5. **P04 + H07 地形道路**：在环境数据合同明确后研究选线。
6. **P07、N01/N02**：作为需求反馈与语言编排的后续研究。

最值得首先做的研究样例是：同一片有坡地和水域的场地，比较“当前规则布置”与“环境兴趣图驱动的聚落生长”，逐步显示选址和接路过程；再比较两种地块划分与建筑布局。这样能直接检验算法是否改善聚落结构。
