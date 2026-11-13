// case-data.js — A2A-T 协作日志参考数据（与《故事线方案文档.md》§1.7/§2.7 同步维护）
// t 为历史排序源（仅保证数组顺序；回放事件时刻以 cases.js events 为准）；
// clock 为占位初始值（base+t），回放时钟由 cases.js CLOCKS 定稿值覆写
//（V5：时钟冻结为业务时间线定稿——工单1=02:18:05+173分、工单2=10:20:08+39分，
// 与回放编排解耦，见方案文档 0.2/0.6）。
// dir: request=请求 / response=响应
// V4 两工单重写：工单1（WO-20261024-7316，跨地市专线中断，含 Negotiation-T 协商、
// 不支持抢通——问题处置=WAIMO 调度处置）；工单2（WO-20261028-5829，跨地市SLA劣化，
// 无协商、仅抢通——问题处置=粤西SPN 隧道调优）。两案故障侧均为粤西（原文档标注矛盾勘误见方案文档 0.5）。
// message 为日志详情完整报文（POST 请求头 / SSE data: 原样呈现，白色等宽 pre-wrap），
// 消息体内时间/流水号已按故事线修正（工单1=2026-10-24 02:18:05；工单2=2026-10-28 10:20:08；
// 末条 Notification OSS流水号=WO-20261028-5829）
// V6.72（用户规格）：敏感信息脱敏——端口名内嵌的真实村名/客户名/街道名 逐段 *，
// 字数保持不变（不重排版）；同类脱敏见 AuthorizationTPanelV4（授权人）/NegotiationPanel 注释
export const CASE_EVENTS = {
  c1: {
    base: '02:18:05',
    events: [
      { t: 146, type: '检索', from: 'WAIMO投诉处理智能体', to: '注册中心', summary: '检索命中：传输投诉处理智能体',
        message: '## 检索请求\nagent.skill = 专线投诉诊断\n\n## 检索结果\n1. 传输投诉处理智能体（传输工作台）\n   - 技能：任务规划 / 并行调度 / 综合研判' },
      { t: 155, type: 'Task-T', dir: 'request', from: 'WAIMO投诉处理智能体', to: '传输投诉处理智能体', summary: '进行集客专线业务投诉场景网络侧故障诊断，达成诊断目标，电路编号：广深VC-7301。故障现象：专线中断。',
        message: `{
    "message": {
        "messageId": "8fedbf6c-f9e4-40f6-b647-04fb602ab8b2",
        "contextId": "83f4d00c-6447-4c70-90a4-9b9288dcd1a4",
        "role": "ROLE_USER",
        "parts": [
            {
                "text": "发起专线投诉诊断",
                "metadata": { }
            }
        ],
        "metadata": {
            "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
## 任务类型(Task Type)
集客专线业务投诉诊断
## 任务描述(Task Description)
基于<任务对象>、<任务上下文> 进行集客专线业务投诉场景网络侧故障根因诊断, 达成<任务目标>中定义的投诉诊断目标，按照<预期输出>中定义的结构返回任务处理结果。
## 任务目标(Task Target)
基于用户的投诉上下文信息，对网络侧故障进行根因诊断，返回故障根因、修复建议等诊断结果信息。
## 任务对象(Task Object)
电路编号：广深VC-7301。产品编号：30122075634。A端接入端口：P10001-A01-1-1-ETH。
Z端接入端口：P10002-B01-1-1-ETH.200。
## 任务上下文(Task Context)
故障发生时间：2026-10-24 02:18:05。故障现象：专线中断。投诉工单编号：WO-20261024-7316。投诉所在城市：广州。
## 预期输出(Expected Output)
要求投诉诊断任务的结果包含如下信息：1. 诊断结果；参数的取值范围包括：成功、失败；(必选)2. 诊断结果详细信息； (必选)3. 修复建议； (可选)4. 故障根因列表，每个故障根因包含故障根因名称、详细描述、修复建议、故障根因点位置等信息； (可选)",
            "templateUri": "Task-T/network-layer/complaint-diagnosis/v1"
        },
        "extensions": [
            "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1"
        ]
    },
    "metadata": { }
}` },
      { t: 199, type: '检索', from: '传输投诉处理智能体', to: '注册中心', summary: '检索命中：粤东SPN网络智能、粤西SPN网络智能',
        message: '## 检索请求\nagent.skill = 专线故障定位·抢通\n\n## 检索结果\n1. 粤东SPN网络智能（专线故障定位·抢通）\n2. 粤西SPN网络智能（专线故障定位·抢通）' },
      { t: 204, type: 'Task-T', dir: 'request', from: '传输投诉处理智能体', to: '粤西SPN网络智能', summary: '对网络侧故障进行诊断，返回故障根因和修复建议等诊断结果信息。接入端口名称：P10001-A01-1-1-ETH',
        message: `POST https://OMCIP:26335/a2a/json/message:stream
Content-Type: application/json
Authorization: Bearer token
A2A-Extensions: https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1
A2A-Version: 1.0
{
  "message": {
    "messageId": "cb9b9a4d-0e9d-4515-9315-77df0e028687",
    "role": "ROLE_USER",
    "parts": [
      {
        "text": "创建专线业务投诉诊断任务"
      }
    ],
    "metadata": {
      "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
## 任务类型(Task Type)
传输专线业务投诉诊断

## 任务描述(Task Description)
基于<任务对象>、<任务上下文> 进行投诉场景的网络侧故障根因诊断, 达成<任务目标>中定义的投诉诊断目标，按照<预期输出>中定义的结构返回任务处理结果。

## 任务目标(Task Target)
对网络侧故障进行诊断，返回故障根因和修复建议等诊断结果信息。

## 任务对象(Task Object)
接入端口名称：P10001-A01-1-1-ETH

## 任务上下文(Task Context)
投诉分类：专线中断；问题发生时间：2026-10-24T02:18:05；OSS侧事件流水号：WO-20261024-7316；投诉详情：专线中断，本智能体负责片区为粤西，片区内告警：告警区域GX-L-U2000
",
      "templateUri": "Task-T/private-line-complaint/v1"
    }
  }
}` },
      { t: 205, type: 'Task-T', dir: 'request', from: '传输投诉处理智能体', to: '粤东SPN网络智能', summary: '对网络侧故障进行诊断，返回故障根因和修复建议等诊断结果信息。接入端口名称：P10002-B01-1-1-ETH.200',
        message: `POST https://OMCIP:26335/a2a/json/message:stream
Content-Type: application/json
Authorization: Bearer token
A2A-Extensions: https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1
A2A-Version: 1.0
{
  "message": {
    "messageId": "cb9b9a4d-0e9d-4515-9315-77df0e028687",
    "role": "ROLE_USER",
    "parts": [
      {
        "text": "创建专线业务投诉诊断任务"
      }
    ],
    "metadata": {
      "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
## 任务类型(Task Type)
传输专线业务投诉诊断

## 任务描述(Task Description)
基于<任务对象>、<任务上下文> 进行投诉场景的网络侧故障根因诊断, 达成<任务目标>中定义的投诉诊断目标，按照<预期输出>中定义的结构返回任务处理结果。

## 任务目标(Task Target)
对网络侧故障进行诊断，返回故障根因和修复建议等诊断结果信息。

## 任务对象(Task Object)
接入端口名称：P10002-B01-1-1-ETH.200

## 任务上下文(Task Context)
投诉分类：专线中断；问题发生时间：2026-10-24T02:18:05；OSS侧事件流水号：WO-20261024-7316；投诉详情：专线中断，本智能体负责片区为粤东，片区内告警：告警区域GD-L-U2000
",
      "templateUri": "Task-T/private-line-complaint/v1"
    }
  }
}` },
      { t: 215, type: 'Negotiation-T', dir: 'request', from: '粤西SPN网络智能', to: '传输投诉处理智能体', summary: '接入端口名称不唯一，该端口下存在多个业务接入口，请提供具体的子接口ID或VLAN ID以确认唯一的业务',
        message: `{
    "message": {
        "messageId": "2bc2bdf4-f626-4e19-aef4-302b9ad0f412",
        "contextId": "cb47672f-af57-4240-8898-d962465cae23",
        "role": "ROLE_AGENT",
        "parts": [
            {
                "text": "存在信息缺失，请补充信息",
                "metadata": { }
            }
        ],
        "metadata": {
            "templateUri": "Negotiation-T/information-negotiation/propose/v1",
            "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Negotiation-T/v1": "## 信息协商请根据<所需信息项>补充相关内容## 所需信息项1. 接入端口名称不唯一，该端口下存在多个业务接入口，请提供具体的子接口ID或VLAN ID以确认唯一的业务，示例："网元名-端口名(cvlan=xx)"",
            "negotiationContext": {
                "id": "6dc9b06b-a398-4603-80f3-15f9c7b11e72",
                "performative": "PROPOSE",
                "round": 1,
                "maxRounds": 5
            }
        }
    }
}` },
      { t: 240, type: 'Negotiation-T', dir: 'response', from: '传输投诉处理智能体', to: '粤西SPN网络智能', summary: '接入端口名称：P10001-A01-1-1-ETH (cvlan=1208)',
        message: `{
    "message": {
        "taskId": "2bc2bdf4-f626-4e19-aef4-302b9ad0f412",
        "role": "ROLE_USER",
        "parts": [
            {
                "text": "已补充信息"
            }
        ],
        "metadata": {
            "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Negotiation-T": "
## 信息协商结果内容
接入端口名称：P10001-A01-1-1-ETH (cvlan=1208)"
        },
        "messageId": "5c9ccfb5-56e8-4f09-abdd-572bfd9bcfba"
    }
}` },
      { t: 260, type: 'Task-T', dir: 'response', from: '粤西SPN网络智能', to: '传输投诉处理智能体', summary: '诊断结果详情：P10005-A02 的 12-2 端口收光无光，发光正常，原因是光纤中断。',
        message: `data: {
    "artifactUpdate": {
        "taskId": "098a7674-1b0c-4886-aa1b-d991f6adc724",
        "contextId": "28d904b3-09ac-425d-83fb-6f61c5d1ac59",
        "artifact": {
            "artifactId": "b1c7db89-5540-43c0-98f7-83e3eef7cdf6",
            "parts": [
                {
                    "text": "专线业务投诉诊断任务诊断结果消息"
                }
            ],
            "metadata": { "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
1. 诊断结果：成功
2. 诊断结果详情：P10005-A02 的 12-2 端口收光无光，发光正常，原因是光纤中断。
3. 修复建议： 检查端口的尾纤连接状态，光纤是否存在物理损伤或断裂。
"            }
        }
    }
}` },
      { t: 266, type: 'Task-T', dir: 'response', from: '粤东SPN网络智能', to: '传输投诉处理智能体', summary: '诊断结果详情：未发现故障。',
        message: `data: {
    "artifactUpdate": {
        "taskId": "098a7674-1b0c-4886-aa1b-d991f6adc724",
        "contextId": "28d904b3-09ac-425d-83fb-6f61c5d1ac59",
        "artifact": {
            "artifactId": "b1c7db89-5540-43c0-98f7-83e3eef7cdf6",
            "parts": [
                {
                    "text": "专线业务投诉诊断任务诊断结果消息"
                }
            ],
            "metadata": { "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
1. 诊断结果：成功
2. 诊断结果详情：未诊断到业务中断，请人工接管
3. 修复建议：未诊断到业务中断，请人工接管
"            }
        }
    }
}` },
      { t: 278, type: 'Task-T', dir: 'response', from: '传输投诉处理智能体', to: 'WAIMO投诉处理智能体', summary: '跨城故障协同诊断汇总结果：粤西SPN网络智能 P10005-A02 的 12-2 端口收光无光，发光正常，原因是光纤中断。',
        message: `data: {
    "artifactUpdate": {
        "taskId": "098a7674-1b0c-4886-aa1b-d991f6adc724",
        "contextId": "28d904b3-09ac-425d-83fb-6f61c5d1ac59",
        "artifact": {
            "artifactId": "b1c7db89-5540-43c0-98f7-83e3eef7cdf6",
            "parts": [
                {
                    "text": "专线业务投诉诊断任务诊断结果消息"
                }
            ],
            "metadata": { "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
1. 诊断结果：成功
2. 诊断结果详情：跨城故障协同诊断汇总结果：粤西SPN网络智能 P10005-A02 的 12-2 端口收光无光，发光正常，原因是光纤中断；粤东SPN网络智能未发现故障。
3. 修复建议：检查端口的尾纤连接状态，光纤是否存在物理损伤或断裂；建议派单现场上站修复。
"            }
        }
    }
}` },
    ],
  },
  c2: {
    base: '10:20:08',
    events: [
      { t: 69, type: '检索', from: 'WAIMO投诉处理智能体', to: '注册中心', summary: '检索命中：传输投诉处理智能体',
        message: '## 检索请求\nagent.skill = 专线投诉诊断\n\n## 检索结果\n1. 传输投诉处理智能体（传输工作台）\n   - 技能：任务规划 / 并行调度 / 综合研判' },
      { t: 74, type: 'Task-T', dir: 'request', from: 'WAIMO投诉处理智能体', to: '传输投诉处理智能体', summary: '进行集客专线业务投诉场景网络侧故障诊断，达成诊断目标，电路编号：广汕VC-8526。故障现象：专线质差。',
        message: `{
    "message": {
        "messageId": "8fedbf6c-f9e4-40f6-b647-04fb602ab8b2",
        "contextId": "83f4d00c-6447-4c70-90a4-9b9288dcd1a4",
        "role": "ROLE_USER",
        "parts": [
            {
                "text": "发起专线投诉诊断",
                "metadata": { }
            }
        ],
        "metadata": {
            "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
## 任务类型(Task Type)
集客专线业务投诉诊断
## 任务描述(Task Description)
基于<任务对象>、<任务上下文> 进行集客专线业务投诉场景网络侧故障根因诊断, 达成<任务目标>中定义的投诉诊断目标，按照<预期输出>中定义的结构返回任务处理结果。
## 任务目标(Task Target)
基于用户的投诉上下文信息，对网络侧故障进行根因诊断，返回故障根因、修复建议等诊断结果信息。
## 任务对象(Task Object)
电路编号：广汕VC-8526。产品编号：30122075634。A端接入端口：P10003-C01-1-1-ETH。
Z端接入端口：P10004-D01-1-1-ETH.353。
## 任务上下文(Task Context)
故障发生时间：2026-10-28 10:20:08。故障现象：专线质差。投诉工单编号：WO-20261028-5829。投诉所在城市：广州。
## 预期输出(Expected Output)
要求投诉诊断任务的结果包含如下信息：1. 诊断结果；参数的取值范围包括：成功、失败；(必选)2. 诊断结果详细信息； (必选)3. 修复建议； (可选)4. 故障根因列表，每个故障根因包含故障根因名称、详细描述、修复建议、故障根因点位置等信息； (可选)",
            "templateUri": "Task-T/network-layer/complaint-diagnosis/v1"
        },
        "extensions": [
            "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1"
        ]
    },
    "metadata": { }
}` },
      { t: 89, type: '检索', from: '传输投诉处理智能体', to: '注册中心', summary: '检索命中：粤东SPN网络智能、粤西SPN网络智能',
        message: '## 检索请求\nagent.skill = 专线故障定位·抢通\n\n## 检索结果\n1. 粤东SPN网络智能（专线故障定位·抢通）\n2. 粤西SPN网络智能（专线故障定位·抢通）' },
      { t: 95, type: 'Task-T', dir: 'request', from: '传输投诉处理智能体', to: '粤东SPN网络智能', summary: '对网络侧故障进行诊断，返回故障根因和修复建议等诊断结果信息。接入端口名称：P10004-D01-1-1-ETH.353',
        message: `POST https://OMCIP:26335/a2a/json/message:stream
Content-Type: application/json
Authorization: Bearer token
A2A-Extensions: https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1
A2A-Version: 1.0
{
  "message": {
    "messageId": "cb9b9a4d-0e9d-4515-9315-77df0e028687",
    "role": "ROLE_USER",
    "parts": [
      {
        "text": "创建专线业务投诉诊断任务"
      }
    ],
    "metadata": {
      "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
## 任务类型(Task Type)
传输专线业务投诉诊断

## 任务描述(Task Description)
基于<任务对象>、<任务上下文> 进行投诉场景的网络侧故障根因诊断, 达成<任务目标>中定义的投诉诊断目标，按照<预期输出>中定义的结构返回任务处理结果。

## 任务目标(Task Target)
对网络侧故障进行诊断，返回故障根因和修复建议等诊断结果信息。

## 任务对象(Task Object)
接入端口名称：P10004-D01-1-1-ETH.353

## 任务上下文(Task Context)
投诉分类：专线质差；问题发生时间：2026-10-28T10:20:08；OSS侧事件流水号：WO-20261028-5829；投诉详情：专线质差，本智能体负责片区为粤东，片区内告警：告警区域GD-L-U2000
",
      "templateUri": "Task-T/private-line-complaint/v1"
    }
  }
}` },
      // V6.4（1020 文档 3.2.3 修订）：Task-T 任务对象 A端端口名未含子接口标识
      //（-ETH.409 删除）→ 粤西 发起 Negotiation-T 协商
      { t: 96, type: 'Task-T', dir: 'request', from: '传输投诉处理智能体', to: '粤西SPN网络智能', summary: '对网络侧故障进行诊断，返回故障根因和修复建议等诊断结果信息。接入端口名称：P10003-C01-1-1-ETH',
        message: `POST https://OMCIP:26335/a2a/json/message:stream
Content-Type: application/json
Authorization: Bearer token
A2A-Extensions: https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1
A2A-Version: 1.0
{
  "message": {
    "messageId": "cb9b9a4d-0e9d-4515-9315-77df0e028687",
    "role": "ROLE_USER",
    "parts": [
      {
        "text": "创建专线业务投诉诊断任务"
      }
    ],
    "metadata": {
      "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
## 任务类型(Task Type)
传输专线业务投诉诊断

## 任务描述(Task Description)
基于<任务对象>、<任务上下文> 进行投诉场景的网络侧故障根因诊断, 达成<任务目标>中定义的投诉诊断目标，按照<预期输出>中定义的结构返回任务处理结果。

## 任务目标(Task Target)
对网络侧故障进行诊断，返回故障根因和修复建议等诊断结果信息。

      ## 任务对象(Task Object)
      接入端口名称：P10003-C01-1-1-ETH

      ## 任务上下文(Task Context)
      投诉分类：专线质差；问题发生时间：2026-10-28T10:20:08；OSS侧事件流水号：WO-20261028-5829；投诉详情：专线质差，本智能体负责片区为粤西，片区内告警：告警区域GX-L-U2000
      ",
      "templateUri": "Task-T/private-line-complaint/v1"
    }
  }
}` },
      // 粤东（Z端端口唯一）的诊断结果响应；粤西 发起 Negotiation-T 协商补充子接口标识，
      // 工作台 补充 cvlan=409（V6.4，1020 文档 3.2.3 修订）——V6.11（用户规格）：粤东的
      // Task-T响应 等粤西协商结束后发送（回放 360..372），日志表按故事时序排列：
      // 协商请求 → 协商响应 → 粤东响应 → 粤西响应
      { t: 101, type: 'Negotiation-T', dir: 'request', from: '粤西SPN网络智能', to: '传输投诉处理智能体', summary: '接入端口名称不唯一，该端口下存在多个业务接入口，请提供具体的子接口ID或VLAN ID以确认唯一的业务',
        message: `{
    "message": {
        "messageId": "2bc2bdf4-f626-4e19-aef4-302b9ad0f412",
        "contextId": "cb47672f-af57-4240-8898-d962465cae23",
        "role": "ROLE_AGENT",
        "parts": [
            {
                "text": "存在信息缺失，请补充信息",
                "metadata": { }
            }
        ],
        "metadata": {
            "templateUri": "Negotiation-T/information-negotiation/propose/v1",
            "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Negotiation-T/v1": "## 信息协商请根据<所需信息项>补充相关内容## 所需信息项1. 接入端口名称不唯一，该端口下存在多个业务接入口，请提供具体的子接口ID或VLAN ID以确认唯一的业务，示例："网元名-端口名(cvlan=xx)"",
            "negotiationContext": {
                "id": "6dc9b06b-a398-4603-80f3-15f9c7b11e72",
                "performative": "PROPOSE",
                "round": 1,
                "maxRounds": 5
            }
        }
    }
}` },
      { t: 102, type: 'Negotiation-T', dir: 'response', from: '传输投诉处理智能体', to: '粤西SPN网络智能', summary: '接入端口名称：P10003-C01-1-1-ETH (cvlan=409)',
        message: `{
    "message": {
        "taskId": "2bc2bdf4-f626-4e19-aef4-302b9ad0f412",
        "role": "ROLE_USER",
        "parts": [
            {
                "text": "已补充信息"
            }
        ],
        "metadata": {
            "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Negotiation-T": "
## 信息协商结果内容
接入端口名称：P10003-C01-1-1-ETH (cvlan=409)"
        },
        "messageId": "5c9ccfb5-56e8-4f09-abdd-572bfd9bcfba",
        "contextId": "cb47672f-af57-4240-8898-d962465cae23"
    }
}` },
      { t: 103, type: 'Task-T', dir: 'response', from: '粤东SPN网络智能', to: '传输投诉处理智能体', summary: '诊断结果未发现业务质差',
        message: `data: {"artifactUpdate": {"taskId": "03987557-f410-403d-ab50-8cb61c77018d","contextId": "c711a453-9b5a-4872-ae3e-5d30681e53a9","artifact": {"artifactId": "87f68f37-1cbc-4c36-b010-e3c3f7a3a58c","name": "private-line-service-complain-diagnosis","parts": [{"text": "业务投诉诊断任务诊断结果消息","metadata": {}}],"metadata": {"https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
1. 诊断结果：成功
2. 诊断结果详情：未诊断到业务质差，请人工接管
3. 修复建议：未诊断到业务质差，请人工接管"}},"metadata": {}}}` },
      { t: 106, type: 'Task-T', dir: 'response', from: '粤西SPN网络智能', to: '传输投诉处理智能体', summary: '检测到链路存在光路隐患，建议下发调优',
        message: `data: {
    "artifactUpdate": {
        "taskId": "37b3ef0c-c7d7-4b38-9e5e-b405e4670a27",
        "contextId": "28d904b3-09ac-425d-83fb-6f61c5d1ac59",
        "artifact": {
            "artifactId": "55795e50-32d6-4228-ae82-a4ad861a6b70",
            "parts": [
                {
                    "text": "专线业务投诉诊断任务诊断结果消息"
                }
            ],
            "metadata": { "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
1. 诊断结果：成功
2. 诊断结果详情：网元P45054-HW-PTN980B的端口1-TPN2EX10S-3(PORT-3)到网元P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03 -HW-PTN980B的端口1-TPN2EX10S-3(PORT-3)链路存在光路隐患。当前业务流在保护隧道，保护隧道存在光路隐患，建议进行调优操作。
隐患位置及隐患详情如下：
P45054-HW-PTN980B 收光方向0.226km处存在纤损
P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03 -HW-PTN980B收光方向 0.309km处存在纤损
3. 修复建议：确认思维链结果后下发调优，检查告警是否清除。
4. 故障根因列表：
   - 故障根因名称：光路隐患，详细描述：网元P45054-HW-PTN980B的端口1-TPN2EX10S-3(PORT-3)到网元P45053-HW-PTN980B的端口1-TPN2EX10S-3(PORT-3)链路存在光路隐患。当前业务流在保护隧道，保护隧道存在光路隐患，建议进行调优操作。
隐患位置及隐患详情如下：
P45054-HW-PTN980B收光方向0.226km处存在纤损
P45053-HW-PTN980B收光方向0.309km处存在纤损
，修复建议：确认思维链结果后下发调优，检查告警是否清除。，故障根因点位置：链路4ba2a816-54ca-4ec6-bdba-bb0c995c9ff2，故障对象标识：4ba2a816-54ca-4ec6-bdba-bb0c995c9ff2，故障对象类型：LINK
"            }
        }
    }
}` },
      { t: 119, type: 'Task-T', dir: 'response', from: '传输投诉处理智能体', to: 'WAIMO投诉处理智能体', summary: '跨城故障协同诊断汇总结果：粤西SPN网络智能端口收光弱光，发光正常，原因是光纤整体损耗大。',
        message: `data: {
    "artifactUpdate": {
        "taskId": "37b3ef0c-c7d7-4b38-9e5e-b405e4670a27",
        "contextId": "28d904b3-09ac-425d-83fb-6f61c5d1ac59",
        "artifact": {
            "artifactId": "55795e50-32d6-4228-ae82-a4ad861a6b70",
            "parts": [
                {
                    "text": "专线业务投诉诊断任务诊断结果消息"
                }
            ],
            "metadata": { "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Task-T/v1": "
1. 诊断结果：成功
2. 诊断结果详情：跨城故障协同诊断汇总结果：粤西SPN网络智能端口收光弱光，发光正常，原因是光纤整体损耗大；粤东SPN网络智能未发现故障。
3. 修复建议：确认思维链结果后下发隧道调优，检查告警是否清除。
4. 故障根因列表：
   - 故障根因名称：光路隐患，详细描述：网元P45054-HW-PTN980B的端口1-TPN2EX10S-3(PORT-3)到网元P45053-HW-PTN980B的端口1-TPN2EX10S-3(PORT-3)链路存在光路隐患。当前业务流在保护隧道，保护隧道存在光路隐患，建议进行调优操作。
隐患位置及隐患详情如下：
P45054-HW-PTN980B收光方向0.226km处存在纤损
P45053-HW-PTN980B收光方向0.309km处存在纤损
，修复建议：确认思维链结果后下发调优，检查告警是否清除。，故障根因点位置：链路4ba2a816-54ca-4ec6-bdba-bb0c995c9ff2，故障对象标识：4ba2a816-54ca-4ec6-bdba-bb0c995c9ff2，故障对象类型：LINK
"            }
        }
    }
}` },
      // V6.4（1020 文档 3.2.3 修订）：抢通方案为「隧道调优」，涉及动网操作——先经
      // Authorization-T 完成动网操作授权（请求/响应），成功后粤西执行抢通
      { t: 120, type: 'Authorization-T', dir: 'request', from: '传输投诉处理智能体', to: '粤西SPN网络智能', summary: '新增动网操作授权',
        message: `{
    "message": {
        "messageId": "5f5ea1f7-99c2-4a83-ba5e-0cbf62856601",
        "role": "ROLE_USER",
        "parts": [
            {
                "text": "新增动网操作授权"
            }
        ],
        "metadata": {
            "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Authorization-T/v1": "
## 授权策略的操作类型
新增授权策略

## 授权策略的操作描述
请根据<授权策略的操作类型>和<动网操作的授权策略列表>完成相应的授权操作，按照<预期输出>中定义的结构返回授权策略的操作执行结果。<预期输出>表示预期返回内容。

## 动网操作的授权策略列表
  - 动网操作的授权策略1
    - 动网操作的业务场景：业务投诉诊断
    - 动网操作的处置类型：业务抢通
    - 动网操作名称：隧道调优
    - 有效期：2026-10-28T12:00:00Z ~ 2030-10-28T12:00:00Z

## 预期输出
1. 授权操作执行结果，取值范围：成功、失败、部分成功；
2. 授权操作执行成功时，返回执行成功的<动网操作的授权策略列表>；
3. 授权操作执行失败或部分成功时，返回失败列表，包含授权策略和失败原因；
",
            "templateUri": "Authorization-T/authorization-policy-management/v1"
        }
    }
}` },
      { t: 121, type: 'Authorization-T', dir: 'response', from: '粤西SPN网络智能', to: '传输投诉处理智能体', summary: '授权操作执行结果：成功',
        message: `data: {
    "artifactUpdate": {
        "taskId": "b6f58a74-13f9-4476-8232-2235f512ed83",
        "contextId": "508e2aaf-1bec-468b-8398-c5f6d9fd4509",
        "artifact": [
            {
                "parts": [
                    {
                        "text": "动网操作授权结果"
                    }
                ],
                "metadata": { "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Authorization-T/v1": "
## 授权操作执行结果
    授权操作执行结果：成功

## 动网操作的授权策略列表
  - 动网操作的授权策略1
      - 动网操作的授权策略标识：56def66d-1814-40fa-95b3-b6b88ce582ad
      - 动网操作的业务场景：业务投诉诊断
      - 动网操作的处置类型：业务抢通
      - 动网操作名称：隧道调优
      - 有效期：2026-10-28T12:00:00Z ~ 2030-10-28T12:00:00Z
      - 创建时间：2026-10-28T12:00:00Z
      - 最后修改时间：2026-10-28T12:00:00Z
"
            }
        ]
    }
}` },
      { t: 130, type: 'Notification-T', from: '粤西SPN网络智能', to: '传输投诉处理智能体', summary: '抢通方案上报',
        message: `data: {
    "artifactUpdate": {
        "taskId": "37b3ef0c-c7d7-4b38-9e5e-b405e4670a27",
        "contextId": "5202b9df-5eeb-4a37-b0a5-7e6e776196a8",
        "artifact": {
            "artifactId": "9c51ee8a-0284-4856-a90f-bd22f3765f5f",
            "parts": [
                {
                    "text": "业务抢通事件"
                }
            ],
            "metadata": { "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Notification-T/v1": "
### 业务抢通事件
1. 业务抢通方案执行状态：未启动
2. 投诉诊断任务流水号；37b3ef0c-c7d7-4b38-9e5e-b405e4670a27
3. OSS侧事件流水号；WO-20261028-5829
4. 接入端口名称；P10003-C01-1-1-ETH.409
5. 是否已授权OMC自动抢通；是
6. 业务抢通方案名称；隧道调优
7. 业务抢通方案详情；
    场景: PROTECT_PATH_FAULT; 抢通方案已就绪，已自动下发执行
    调优前：
    - 隧道1：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel2，源网元:P48010-海珠2时钟源下沉-CPE-03，宿网元:P45053-HW-PTN980B，主备类型：protect，状态：down，时延：28ms，丢包率：0.9%
       - 隧道路由列表：
          - 链路0：P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)-P45054-HW-PTN980B_1-TPN2EX10S-7(PORT-7)，源网元:P48010-海珠2时钟源下沉-CPE-03，源端口：2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)，宿网元:P45054-HW-PTN980B，宿端口：1-TPN2EX10S-7(PORT-7)，时延：28ms
          - 链路1：P45054-HW-PTN980B_1-TPN2EX10S-3(PORT-3)-P45053-HW-PTN980B_1-TPN2EX10S-3(PORT-3)，源网元:P45054-HW-PTN980B，源端口：1-TPN2EX10S-3(PORT-3)，宿网元:P45053-HW-PTN980B，宿端口：1-TPN2EX10S-3(PORT-3)，时延：28ms
    - 隧道2：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel12，源网元:P45053-HW-PTN980B，宿网元:P48010-海珠2时钟源下沉-CPE-03，主备类型：protect，状态：down，时延：28ms，丢包率：0.9%
       - 隧道路由列表：
          - 链路0：P45053-HW-PTN980B_1-TPN2EX10S-3(PORT-3)-P45054-HW-PTN980B_1-TPN2EX10S-3(PORT-3)，源网元:P45053-HW-PTN980B，源端口：1-TPN2EX10S-3(PORT-3)，宿网元:P45054-HW-PTN980B，宿端口：1-TPN2EX10S-3(PORT-3)，时延：28ms
          - 链路1：P45054-HW-PTN980B_1-TPN2EX10S-7(PORT-7)-P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)，源网元:P45054-HW-PTN980B，源端口：1-TPN2EX10S-7(PORT-7)，宿网元:P48010-海珠2时钟源下沉-CPE-03，宿端口：2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)，时延：28ms
    调优后：
    - 隧道1：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel2，源网元:P48010-海珠2时钟源下沉-CPE-03，宿网元:P45053-HW-PTN980B，主备类型：protect，状态：up，时延：5ms，丢包率：0.01%
       - 隧道路由列表：
          - 链路0：P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)-P45053-HW-PTN980B_1-TPN2EX10S-7(PORT-7)，源网元:P48010-海珠2时钟源下沉-CPE-03，源端口：2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)，宿网元:P45053-HW-PTN980B，宿端口：1-TPN2EX10S-7(PORT-7)，时延：5ms
    - 隧道2：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel12，源网元:P45053-HW-PTN980B，宿网元:P48010-海珠2时钟源下沉-CPE-03，主备类型：protect，状态：up，时延：5ms，丢包率：0.01%
       - 隧道路由列表：
          - 链路0：P45053-HW-PTN980B_1-TPN2EX10S-7(PORT-7)-P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)，源网元:P45053-HW-PTN980B，源端口：1-TPN2EX10S-7(PORT-7)，宿网元:P48010-海珠2时钟源下沉-CPE-03，宿端口：2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)，时延：5ms
" }
        }
    }
}` },
      { t: 141, type: 'Notification-T', from: '粤西SPN网络智能', to: '传输投诉处理智能体', summary: '业务抢通执行成功',
        message: `data: {
    "artifactUpdate": {
        "taskId": "37b3ef0c-c7d7-4b38-9e5e-b405e4670a27",
        "contextId": "5202b9df-5eeb-4a37-b0a5-7e6e776196a8",
        "artifact": {
            "artifactId": "800acb99-09d2-4948-9d79-f9080e82b178",
            "parts": [
                {
                    "text": "业务抢通事件"
                }
            ],
            "metadata": { "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Notification-T/v1": "
### 业务抢通事件
1. 业务抢通方案执行状态：已结束
2. 投诉诊断任务流水号；37b3ef0c-c7d7-4b38-9e5e-b405e4670a27
3. OSS侧事件流水号；WO-20261028-5829
4. 接入端口名称；P10003-C01-1-1-ETH.409
5. 是否已授权OMC自动抢通；是
6. 业务抢通方案名称；隧道调优
7. 业务抢通方案详情；
    场景: PROTECT_PATH_FAULT; 调优下发: 成功
    调优前：
    - 隧道1：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel2，源网元:P48010-海珠2时钟源下沉-CPE-03，宿网元:P45053-HW-PTN980B，主备类型：protect，状态：down，时延：28ms，丢包率：0.9%
       - 隧道路由列表：
          - 链路0：P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)-P45054-HW-PTN980B_1-TPN2EX10S-7(PORT-7)，源网元:P48010-海珠2时钟源下沉-CPE-03，源端口：2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)，宿网元:P45054-HW-PTN980B，宿端口：1-TPN2EX10S-7(PORT-7)，时延：28ms
          - 链路1：P45054-HW-PTN980B_1-TPN2EX10S-3(PORT-3)-P45053-HW-PTN980B_1-TPN2EX10S-3(PORT-3)，源网元:P45054-HW-PTN980B，源端口：1-TPN2EX10S-3(PORT-3)，宿网元:P45053-HW-PTN980B，宿端口：1-TPN2EX10S-3(PORT-3)，时延：28ms
    - 隧道2：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel12，源网元:P45053-HW-PTN980B，宿网元:P48010-海珠2时钟源下沉-CPE-03，主备类型：protect，状态：down，时延：28ms，丢包率：0.9%
       - 隧道路由列表：
          - 链路0：P45053-HW-PTN980B_1-TPN2EX10S-3(PORT-3)-P45054-HW-PTN980B_1-TPN2EX10S-3(PORT-3)，源网元:P45053-HW-PTN980B，源端口：1-TPN2EX10S-3(PORT-3)，宿网元:P45054-HW-PTN980B，宿端口：1-TPN2EX10S-3(PORT-3)，时延：28ms
          - 链路1：P45054-HW-PTN980B_1-TPN2EX10S-7(PORT-7)-P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)，源网元:P45054-HW-PTN980B，源端口：1-TPN2EX10S-7(PORT-7)，宿网元:P48010-海珠2时钟源下沉-CPE-03，宿端口：2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)，时延：28ms
    调优后：
    - 隧道1：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel2，源网元:P48010-海珠2时钟源下沉-CPE-03，宿网元:P45053-HW-PTN980B，主备类型：protect，状态：up，时延：5ms，丢包率：0.01%
       - 隧道路由列表：
          - 链路0：P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)-P45053-HW-PTN980B_1-TPN2EX10S-7(PORT-7)，源网元:P48010-海珠2时钟源下沉-CPE-03，源端口：2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)，宿网元:P45053-HW-PTN980B，宿端口：1-TPN2EX10S-7(PORT-7)，时延：5ms
    - 隧道2：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel12，源网元:P45053-HW-PTN980B，宿网元:P48010-海珠2时钟源下沉-CPE-03，主备类型：protect，状态：up，时延：5ms，丢包率：0.01%
       - 隧道路由列表：
          - 链路0：P45053-HW-PTN980B_1-TPN2EX10S-7(PORT-7)-P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)，源网元:P45053-HW-PTN980B，源端口：1-TPN2EX10S-7(PORT-7)，宿网元:P48010-海珠2时钟源下沉-CPE-03，宿端口：2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)，时延：5ms
8. 业务抢通方案执行结束时间；2026-10-28T10:47:05.000000000Z
9. 业务抢通方案执行结果：成功
" }
        }
    }
}` },
      { t: 160, type: 'Notification-T', from: '传输投诉处理智能体', to: 'WAIMO投诉处理智能体', summary: '专线业务已经完成抢通修复，经过验证业务的SLA已经恢复正常。',
        message: `data: {
    "artifactUpdate": {
        "taskId": "37b3ef0c-c7d7-4b38-9e5e-b405e4670a27",
        "contextId": "5202b9df-5eeb-4a37-b0a5-7e6e776196a8",
        "artifact": {
            "artifactId": "800acb99-09d2-4948-9d79-f9080e82b178",
            "parts": [
                {
                    "text": "业务抢通事件"
                }
            ],
            "metadata": { "https://projects.tmforum.org/a2aproject/telecommunication/extensions/Notification-T/v1": "
### 业务抢通事件
1. 业务抢通方案执行状态：已结束
2. 投诉诊断任务流水号；37b3ef0c-c7d7-4b38-9e5e-b405e4670a27
3. OSS侧事件流水号；WO-20261028-5829
4. 接入端口名称；P10003-C01-1-1-ETH.409
5. 是否已授权OMC自动抢通；是
6. 业务抢通方案名称；隧道调优
7. 业务抢通方案详情；
    场景: PROTECT_PATH_FAULT; 调优下发: 成功
    调优前：
    - 隧道1：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel2，源网元:P48010-海珠2时钟源下沉-CPE-03，宿网元:P45053-HW-PTN980B，主备类型：protect，状态：down，时延：28ms，丢包率：0.9%
       - 隧道路由列表：
          - 链路0：P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)-P45054-HW-PTN980B_1-TPN2EX10S-7(PORT-7)，源网元:P48010-海珠2时钟源下沉-CPE-03，源端口：2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)，宿网元:P45054-HW-PTN980B，宿端口：1-TPN2EX10S-7(PORT-7)，时延：28ms
          - 链路1：P45054-HW-PTN980B_1-TPN2EX10S-3(PORT-3)-P45053-HW-PTN980B_1-TPN2EX10S-3(PORT-3)，源网元:P45054-HW-PTN980B，源端口：1-TPN2EX10S-3(PORT-3)，宿网元:P45053-HW-PTN980B，宿端口：1-TPN2EX10S-3(PORT-3)，时延：28ms
    - 隧道2：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel12，源网元:P45053-HW-PTN980B，宿网元:P48010-海珠2时钟源下沉-CPE-03，主备类型：protect，状态：down，时延：28ms，丢包率：0.9%
       - 隧道路由列表：
          - 链路0：P45053-HW-PTN980B_1-TPN2EX10S-3(PORT-3)-P45054-HW-PTN980B_1-TPN2EX10S-3(PORT-3)，源网元:P45053-HW-PTN980B，源端口：1-TPN2EX10S-3(PORT-3)，宿网元:P45054-HW-PTN980B，宿端口：1-TPN2EX10S-3(PORT-3)，时延：28ms
          - 链路1：P45054-HW-PTN980B_1-TPN2EX10S-7(PORT-7)-P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)，源网元:P45054-HW-PTN980B，源端口：1-TPN2EX10S-7(PORT-7)，宿网元:P48010-海珠2时钟源下沉-CPE-03，宿端口：2-HGF1CXPB0-2-CPE-03 ETH-14(TO-P45054)，时延：28ms
    调优后：
    - 隧道1：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel2，源网元:P48010-海珠2时钟源下沉-CPE-03，宿网元:P45053-HW-PTN980B，主备类型：protect，状态：up，时延：5ms，丢包率：0.01%
       - 隧道路由列表：
          - 链路0：P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)-P45053-HW-PTN980B_1-TPN2EX10S-7(PORT-7)，源网元:P48010-海珠2时钟源下沉-CPE-03，源端口：2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)，宿网元:P45053-HW-PTN980B，宿端口：1-TPN2EX10S-7(PORT-7)，时延：5ms
    - 隧道2：P45053-HW-PTN980B_P48010-海珠2时钟源下沉-CPE-03_20260922 Tunnel12，源网元:P45053-HW-PTN980B，宿网元:P48010-海珠2时钟源下沉-CPE-03，主备类型：protect，状态：up，时延：5ms，丢包率：0.01%
       - 隧道路由列表：
          - 链路0：P45053-HW-PTN980B_1-TPN2EX10S-7(PORT-7)-P48010-海珠2时钟源下沉-CPE-03_2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)，源网元:P45053-HW-PTN980B，源端口：1-TPN2EX10S-7(PORT-7)，宿网元:P48010-海珠2时钟源下沉-CPE-03，宿端口：2-HGF1CXPB0-2-CPE-03 ETH-13(TO-P45053)，时延：5ms
8. 业务抢通方案执行结束时间；2026-10-28T10:47:05.000000000Z
9. 业务抢通方案执行结果：成功
" }
        }
    }
}` },
    ],
  },
};

// 由参考数据生成日志行（badge/clock/from/to/summary/prompt/step）
// 徽章规则：检索 →「检索」；Notification-T →「Notification-T通知」；
// 其余 Task-T/Negotiation-T + 请求/响应；clock 为占位初始值（base+t），
// 回放时钟由 cases.js CLOCKS 冻结定稿值覆写（V5，业务时间线不随回放编排变动）
export function buildLogs(src) {
  const [h, m, s] = src.base.split(':').map(Number);
  const base = h * 3600 + m * 60 + s;
  return src.events.map((e) => {
    const tot = base + e.t;
    const p2 = (v) => String(Math.floor(v)).padStart(2, '0');
    const ms = String(Math.round((tot - Math.floor(tot)) * 1000)).padStart(3, '0');
    const badge = e.from === e.to
      ? '内部'
      : e.type === '检索'
        ? '检索'
        : e.type === 'Notification-T'
          ? 'Notification-T通知'
          : e.type + (e.dir === 'response' ? '响应' : '请求');
    return {
      badge,
      clock: p2(Math.floor(tot / 3600)) + ':' + p2(Math.floor(tot / 60) % 60) + ':' + p2(Math.floor(tot) % 60) + '.' + ms,
      from: e.from,
      to: e.to,
      summary: e.summary,
      prompt: e.message,
      step: e.step || null,
    };
  });
}
