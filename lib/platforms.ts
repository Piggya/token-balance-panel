export type Currency = "CNY" | "USD";
export type PlatformKind = "balance" | "quota" | "credits";
export type PlatformAuth = "key" | "session" | "workbuddy" | "qoder" | "zhipu";
export type CredentialKey = "key" | "session" | "token" | "uid";

export interface PlatformChannel {
  kind: "api" | "cookie";
  label: string;
  detail: string;
}

export interface CredentialField {
  key: CredentialKey;
  label: string;
  placeholder: string;
  secret: boolean;
}

export interface CredentialFormat {
  label: string;
  pattern: string;
}

export interface PlatformGuide {
  formats: CredentialFormat[];
  steps: string[];
  notes: string[];
}

export interface PlatformMeta {
  id: string;
  name: string;
  vendor: string;
  monogram: string;
  accent: string;
  consoleUrl: string;
  kind: PlatformKind;
  currency: Currency;
  defaultThreshold: number;
  auth: PlatformAuth;
  channel: PlatformChannel;
  // Headline above the primary number on quota-kind cards.
  quotaHeadline?: string;
  fields: CredentialField[];
  help: string;
  guide: PlatformGuide;
}

const API_KEY_FIELD: CredentialField = {
  key: "key",
  label: "API Key",
  placeholder: "sk-...",
  secret: true,
};

export const PLATFORM_META: Record<string, PlatformMeta> = {
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    vendor: "深度求索",
    monogram: "DS",
    accent: "#5b8cff",
    consoleUrl: "https://platform.deepseek.com/",
    kind: "balance",
    currency: "CNY",
    defaultThreshold: 10,
    auth: "key",
    channel: {
      kind: "api",
      label: "官方 API · API Key",
      detail: "使用 API Key 调用 DeepSeek 官方余额接口 /user/balance 查询。",
    },
    fields: [API_KEY_FIELD],
    help: "在平台控制台的 API Key 页面创建并复制，余额按人民币返回。",
    guide: {
      formats: [
        {
          label: "API Key",
          pattern: "以 sk- 开头，后接一长串字母与数字，中间没有空格",
        },
      ],
      steps: [
        "打开 platform.deepseek.com 并登录。",
        "点击左侧「API Keys」，再点「创建 API Key」。",
        "填写名称并确认，复制列表里的 Key。",
        "回到这里，把 Key 粘贴到「API Key」输入框。",
      ],
      notes: [
        "只复制 Key 本身，不要带引号、空格或 Bearer 前缀。",
        "余额按人民币显示，查询的是账户可用总额。",
      ],
    },
  },
  moonshot: {
    id: "moonshot",
    name: "Kimi",
    vendor: "Moonshot",
    monogram: "K",
    accent: "#a78bfa",
    consoleUrl: "https://platform.moonshot.cn/",
    kind: "balance",
    currency: "CNY",
    defaultThreshold: 10,
    auth: "key",
    channel: {
      kind: "api",
      label: "官方 API · API Key",
      detail: "使用 API Key 调用 Kimi 开放平台余额接口 /v1/users/me/balance 查询。",
    },
    fields: [API_KEY_FIELD],
    help: "在 Kimi 开放平台创建 API Key，可查看可用余额与代金券。",
    guide: {
      formats: [
        {
          label: "API Key",
          pattern: "以 sk- 开头的一长串字母与数字",
        },
      ],
      steps: [
        "打开 platform.moonshot.cn 并登录。",
        "进入「API Key 管理」页面。",
        "点击「新建 API Key」，复制生成的内容。",
        "回到这里，把 Key 粘贴到输入框。",
      ],
      notes: [
        "只复制 Key 本身，不要带 Bearer 前缀。",
        "面板同时显示现金余额与代金券余额。",
      ],
    },
  },
  siliconflow: {
    id: "siliconflow",
    name: "硅基流动",
    vendor: "SiliconFlow",
    monogram: "SF",
    accent: "#ff9e64",
    consoleUrl: "https://cloud.siliconflow.cn/",
    kind: "balance",
    currency: "CNY",
    defaultThreshold: 10,
    auth: "session",
    channel: {
      kind: "cookie",
      label: "控制台接口 · 登录 Cookie",
      detail: "API Key 余额接口已于 2026-08-14 下线，改为使用登录 Cookie 调用控制台钱包接口查询。",
    },
    fields: [{
      key: "session",
      label: "登录 Cookie",
      placeholder: "__SF_auth.session-token=…",
      secret: true,
    }],
    help: "API Key 余额接口已下线，改为登录控制台后从任意 iam-server 请求复制 Cookie。",
    guide: {
      formats: [
        {
          label: "登录 Cookie",
          pattern: "请求头 Cookie 中 __SF_auth.session-token 的值，通常是 eyJ 开头的长串；整行 Cookie 也可以直接粘贴",
        },
      ],
      steps: [
        "登录 cloud.siliconflow.cn，打开「余额充值」页面确认能看到余额。",
        "按 F12 打开开发者工具，切到「网络 / Network」，筛选 iam-server 并刷新页面。",
        "打开任意 iam-server 请求，找到「请求头 / Request Headers」里的 Cookie。",
        "复制整个 Cookie 值（至少包含 __SF_auth.session-token=…），回到这里粘贴。",
      ],
      notes: [
        "硅基流动的 API Key 余额接口已于 2026-08-14 下线，面板改用控制台登录态查询。",
        "Cookie 等同于登录状态，保存时加密存储；勾选「30 天内保持登录」可以延长有效期。",
        "退出登录或会话过期后卡片会提示凭据失效，重新登录并复制一次即可。",
      ],
    },
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    vendor: "模型聚合平台",
    monogram: "OR",
    accent: "#5eead4",
    consoleUrl: "https://openrouter.ai/",
    kind: "balance",
    currency: "USD",
    defaultThreshold: 2,
    auth: "key",
    channel: {
      kind: "api",
      label: "官方 API · API Key",
      detail: "使用 API Key 调用 OpenRouter 官方额度接口 /api/v1/credits 查询。",
    },
    fields: [{
      key: "key",
      label: "API Key",
      placeholder: "sk-or-v1-...",
      secret: true,
    }],
    help: "在 OpenRouter 的 Keys 页面创建，可用余额按美元计算。",
    guide: {
      formats: [
        {
          label: "API Key",
          pattern: "以 sk-or-v1- 开头，后接一长串字母与数字",
        },
      ],
      steps: [
        "登录 openrouter.ai。",
        "从右上角头像菜单进入「Keys」。",
        "点击「Create Key」，填写名称（可选设置额度上限）。",
        "复制生成的 Key，回到这里粘贴。",
      ],
      notes: [
        "Key 只在创建后完整显示一次，请立即保存。",
        "余额按美元显示，同时展示累计充值和使用额。",
      ],
    },
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    vendor: "Coding Plan",
    monogram: "MM",
    accent: "#ff7a9c",
    consoleUrl: "https://www.minimaxi.com/user-center/payment/coding-plan",
    kind: "quota",
    currency: "CNY",
    defaultThreshold: 0,
    auth: "key",
    channel: {
      kind: "api",
      label: "官方 API · Coding Plan Key",
      detail: "使用 Coding Plan 专属 Key 调用官方额度接口，查询 5 小时窗口与每周额度。",
    },
    quotaHeadline: "5 小时剩余",
    fields: [{
      key: "key",
      label: "Coding Plan Key",
      placeholder: "订阅专属 Key",
      secret: true,
    }],
    help: "使用 Coding Plan 专属 Key，显示 5 小时窗口、每周额度及自动刷新时间。",
    guide: {
      formats: [
        {
          label: "Coding Plan Key",
          pattern: "订阅页复制的完整 Key，是一长串字母与数字（可能包含 - 或 _）",
        },
      ],
      steps: [
        "登录 MiniMax 开放平台，进入订阅管理里的 Coding Plan 页面。",
        "找到 Coding Plan 专属的 API Key，不要使用普通平台 Key。",
        "复制完整内容，回到这里粘贴。",
      ],
      notes: [
        "普通 API Key 无法查询 Coding Plan 额度。",
        "面板显示 5 小时窗口与每周额度的剩余情况，以及下一次刷新时间。",
      ],
    },
  },
  tokenrhythm: {
    id: "tokenrhythm",
    name: "基元律动",
    vendor: "Token Rhythm",
    monogram: "TR",
    accent: "#b6f36a",
    consoleUrl: "https://tokenrhythm.studio/account",
    kind: "balance",
    currency: "CNY",
    defaultThreshold: 10,
    auth: "session",
    channel: {
      kind: "cookie",
      label: "控制台接口 · tr_session Cookie",
      detail: "使用 tr_session Cookie 调用基元律动控制台余额接口查询。",
    },
    fields: [{
      key: "session",
      label: "tr_session Cookie",
      placeholder: "粘贴 tr_session 值或完整 Cookie",
      secret: true,
    }],
    help: "登录控制台后打开 DevTools → Application → Cookies，复制 tr_session 的值。",
    guide: {
      formats: [
        {
          label: "tr_session",
          pattern: "登录后的 tr_session Cookie 值，一长串字母、数字与 % 等符号；完整 Cookie 只要包含 tr_session，粘贴顺序不限",
        },
      ],
      steps: [
        "在浏览器登录 tokenrhythm.studio。",
        "按 F12 打开开发者工具，进入「应用 / Application」→「Cookie」→ tokenrhythm.studio。",
        "找到名为 tr_session 的 Cookie，复制它的值。",
        "看不到 tr_session 时，切到「网络 / Network」，刷新页面，打开任意发往 tokenrhythm.studio 的请求，复制请求头 Cookie 的完整内容。",
      ],
      notes: [
        "Cookie 等同于登录状态，请勿分享给他人；tr_ref_device 等其他 Cookie 不能代替 tr_session。",
        "会话过期后卡片会提示凭据失效，重新登录并复制即可。",
      ],
    },
  },
  qoder: {
    id: "qoder",
    name: "Qoder",
    vendor: "Qoder · 阿里",
    monogram: "QD",
    accent: "#8b5cf6",
    consoleUrl: "https://qoder.cn/account/integrations",
    kind: "quota",
    currency: "CNY",
    defaultThreshold: 0,
    auth: "qoder",
    channel: {
      kind: "api",
      label: "官方 OpenAPI · 个人访问令牌",
      detail:
        "使用个人访问令牌（PAT）兑换临时 job token，再调用官方额度接口 /api/v2/quota/usage 查询套餐 Credits 与资源包。",
    },
    quotaHeadline: "总剩余",
    fields: [{
      key: "key",
      label: "个人访问令牌",
      placeholder: "pt-…",
      secret: true,
    }],
    help: "Qoder 没有网页会话接口，需要在账号设置里创建个人访问令牌（PAT）；国内版为 qoder.cn，国际版为 qoder.com。",
    guide: {
      formats: [
        {
          label: "个人访问令牌",
          pattern: "以 pt- 开头的一长串字母与数字；创建后只显示一次，请立即复制",
        },
      ],
      steps: [
        "登录 qoder.cn（国际版为 qoder.com），进入账号设置中的「个人访问令牌 / Integrations」页面。",
        "点击「创建令牌」，填写名称和有效期后确认。",
        "复制生成的令牌（pt- 开头），回到这里粘贴到「个人访问令牌」输入框。",
        "在「版本」中选择与账号一致的站点：国内版选 qoder.cn，国际版选 qoder.com。",
      ],
      notes: [
        "令牌只在创建时完整显示一次；丢失后删除旧令牌并重新创建即可。",
        "令牌可随时在设置页吊销，等同于额度查询权限，请勿分享。",
        "面板主数字为套餐余量与资源包余额的合计 Credits，额度规则以 Qoder 控制台为准。",
      ],
    },
  },
  workbuddy: {
    id: "workbuddy",
    name: "WorkBuddy",
    vendor: "CodeBuddy · 腾讯",
    monogram: "WB",
    accent: "#7dd3fc",
    consoleUrl: "https://www.workbuddy.cn/profile/plans-usage",
    kind: "credits",
    currency: "CNY",
    defaultThreshold: 500,
    auth: "workbuddy",
    channel: {
      kind: "cookie",
      label: "控制台接口 · 登录 Cookie",
      detail: "使用 session / session_2 Cookie 调用控制台 billing 接口查询积分用量。",
    },
    fields: [
      {
        key: "session",
        label: "登录 Cookie",
        placeholder: "session=…; session_2=…",
        secret: true,
      },
    ],
    help: "登录个人中心后打开 DevTools → Network，在任意 billing 请求的请求头里复制 session 与 session_2 两个 Cookie。",
    guide: {
      formats: [
        {
          label: "登录 Cookie",
          pattern: "请求头 Cookie 里 session 与 session_2 两个值，缺一不可；可以粘贴成 session=…; session_2=… 的形式",
        },
      ],
      steps: [
        "登录 workbuddy.cn（国内版）或 workbuddy.ai（国际版），进入个人中心「积分用量」页面。",
        "按 F12 打开开发者工具，切到「网络 / Network」，筛选 billing 并刷新页面。",
        "找到任意 billing 请求，查看「请求头 / Request Headers」里的 Cookie。",
        "复制 session 与 session_2 两个 Cookie（保持 session=…; session_2=… 的写法）粘贴到输入框。",
      ],
      notes: [
        "Cookie 等同于登录状态，保存时加密存储，但仍请勿分享。",
        "控制台没有长期令牌，Cookie 会随会话轮换或过期；卡片提示凭据失效时重新登录并再复制一次。",
        "在「版本」中选择与账号一致的站点，选错会查询失败。",
      ],
    },
  },
  zhipu: {
    id: "zhipu",
    name: "智谱 AI",
    vendor: "BigModel · GLM",
    monogram: "GLM",
    accent: "#4d6bfe",
    consoleUrl: "https://open.bigmodel.cn/console/overview",
    kind: "balance",
    currency: "CNY",
    defaultThreshold: 10,
    auth: "zhipu",
    quotaHeadline: "5 小时剩余",
    channel: {
      kind: "api",
      label: "官方额度接口 / 控制台余额",
      detail:
        "API Key 调用官方额度接口查询 GLM Coding Plan 的 5 小时与每周窗口；控制台登录令牌调用报表接口查询账户余额。",
    },
    fields: [
      {
        key: "key",
        label: "API Key（Coding Plan 额度）",
        placeholder: "xxxxxxxx.yyyyyyyy",
        secret: true,
      },
      {
        key: "session",
        label: "登录令牌（账户余额）",
        placeholder: "bigmodel_token_production 的值或整行 Cookie",
        secret: true,
      },
    ],
    help: "API Key 与登录令牌任选其一：前者查询 GLM Coding Plan 额度，后者查询账户余额。",
    guide: {
      formats: [
        {
          label: "API Key（额度）",
          pattern: "控制台「API Keys」创建的完整 Key，通常是 xxxxxxxx.yyyyyyyy 两段式",
        },
        {
          label: "登录令牌（余额）",
          pattern: "控制台 Cookie 中 bigmodel_token_production 的值；也可以直接粘贴整行 Cookie",
        },
      ],
      steps: [
        "查额度：登录 open.bigmodel.cn 控制台，进入「API Keys」页面创建并复制 Key，粘贴到第一个输入框。",
        "查余额：打开控制台概览页（open.bigmodel.cn/console/overview），在浏览器 DevTools 的「应用 / Application」→ Cookie 中找到 bigmodel_token_production，复制它的值粘贴到第二个输入框。",
        "两种凭据只需填写一种，保存后立即查询；卡片会按凭据类型显示额度或余额。",
      ],
      notes: [
        "智谱没有面向模型 API Key 的公开余额接口：Coding Plan 额度走官方 monitor 接口，账户余额走控制台报表接口。",
        "登录令牌等同于控制台登录状态，有效期有限；过期后卡片提示凭据失效，重新复制即可。",
        "团队账号查询额度需要额外提供组织与项目标识，面板目前只支持个人账号。",
      ],
    },
  },
};

export function platformMeta(id: string): PlatformMeta {
  return PLATFORM_META[id] ?? {
    id,
    name: id,
    vendor: "未知平台",
    monogram: id.slice(0, 2).toUpperCase(),
    accent: "#9aa4ad",
    consoleUrl: "",
    kind: "balance",
    currency: "CNY",
    defaultThreshold: 10,
    auth: "key",
    channel: {
      kind: "api",
      label: "平台接口 · 凭据",
      detail: "使用平台提供的凭据调用其接口查询余额。",
    },
    fields: [API_KEY_FIELD],
    help: "填写平台提供的凭据。",
    guide: {
      formats: [
        { label: "凭据", pattern: "平台提供的令牌或密钥原文" },
      ],
      steps: [
        "登录平台控制台。",
        "在 API Key / 令牌管理页面创建或查看凭据。",
        "复制完整内容并粘贴到输入框。",
      ],
      notes: ["只复制凭据本身，不要带引号或前缀。"],
    },
  };
}

export const SUPPORTED_PLATFORMS = Object.values(PLATFORM_META);
