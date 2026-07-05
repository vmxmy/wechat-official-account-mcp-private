# 微信公众号官方 API Contract 核验

> 本项目与微信公众号 API 相关的行为，以微信官方开发文档为唯一真源。实现、迁移和文档描述如与官方文档冲突，以官方文档为准，并先修正本文件与相关 OpenSpec。

本文件记录当前项目在 Cloudflare 迁移评估中已核验的微信公众号官方 API contract、当前项目覆盖情况和已知偏差。

## 核验来源

微信官方文档站为 Vue/Webpack SPA，人工可读 URL 在 `https://developers.weixin.qq.com/doc/offiaccount/...` 下。后续实现时应重新打开对应页面确认最新 contract。

主要来源：

- [获取 access_token](https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Get_access_token.html)
- [接收普通消息](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Receiving_standard_messages.html)
- [接收事件推送](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Receiving_event_pushes.html)
- [消息加解密说明](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Message_encryption_and_decryption_instructions.html)
- [被动回复用户消息](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Passive_user_reply_message.html)
- [客服消息](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Service_Center_messages.html)
- [模板消息接口](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Template_Message_Interface.html)
- [公众号一次性订阅消息](https://developers.weixin.qq.com/doc/offiaccount/Message_Management/One-time_subscription_info.html)
- [订阅通知 API](https://developers.weixin.qq.com/doc/offiaccount/Subscription_Messages/api.html)
- [自定义菜单](https://developers.weixin.qq.com/doc/offiaccount/Custom_Menus/Creating_Custom-Defined_Menu.html)
- [用户标签管理](https://developers.weixin.qq.com/doc/offiaccount/User_Management/User_Tag_Management.html)
- [获取用户列表](https://developers.weixin.qq.com/doc/offiaccount/User_Management/Getting_a_User_List.html)
- [获取用户基本信息](https://developers.weixin.qq.com/doc/offiaccount/User_Management/Get_users_basic_information_UnionID.html)
- [新增草稿](https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html)
- [发布接口](https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html)
- [新增永久素材](https://developers.weixin.qq.com/doc/offiaccount/Asset_Management/Adding_Permanent_Assets.html)
- [新增临时素材](https://developers.weixin.qq.com/doc/offiaccount/Asset_Management/New_temporary_materials.html)

## 生产上线关键约束

### access_token

官方接口：

```http
GET https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=APPID&secret=APPSECRET
```

参数：

- `grant_type=client_credential`
- `appid`
- `secret`

返回：

- `access_token`
- `expires_in`

生产注意：官方文档要求调用前在公众号后台配置服务器 IP 白名单。Cloudflare Workers 默认出口 IP 不固定，生产部署前必须解决固定出口或代理问题。

### 入站消息 webhook

明文模式签名：

```text
signature = SHA1(sort(token, timestamp, nonce).join(""))
```

安全模式 / 加密模式签名：

```text
msg_signature = SHA1(sort(token, timestamp, nonce, Encrypt).join(""))
```

要求：

- 加密模式使用 `msg_signature`，不要用 `signature` 验证加密消息。
- 解密后格式为 `random(16B) + msg_len(4B network byte order) + msg + appid`。
- 必须校验解密出的 `appid` 等于当前公众号 AppID。
- 如无特殊回复要求，可返回空串或 `success`。
- 微信服务器约等待 5 秒；超时会断开并重试，总计约 3 次。
- 普通消息用 `MsgId` 去重；事件通常没有 `MsgId`，应由稳定字段生成 `dedup_key`。

已核验的普通消息类型：

| MsgType | 关键字段 |
|---|---|
| `text` | `Content`, `MsgId`, 可选 `MsgDataId`, `Idx` |
| `image` | `PicUrl`, `MediaId`, `MsgId` |
| `voice` | `MediaId`, `Format`, `MediaId16K`, `MsgId` |
| `video` | `MediaId`, `ThumbMediaId`, `MsgId` |
| `shortvideo` | `MediaId`, `ThumbMediaId`, `MsgId` |
| `location` | `Location_X`, `Location_Y`, `Scale`, `Label`, `MsgId` |
| `link` | `Title`, `Description`, `Url`, `MsgId` |

已核验的事件示例：

- `subscribe`, `unsubscribe`
- 带参数二维码关注事件：`EventKey=qrscene_*`, `Ticket`
- `SCAN`: `EventKey`, `Ticket`
- `LOCATION`: `Latitude`, `Longitude`, `Precision`
- 菜单 `CLICK`: `EventKey`
- 菜单 `VIEW`: `EventKey` 为 URL
- 群发结果回调：`MASSSENDJOBFINISH`
- 模板消息发送结果事件

## 已核验接口清单与项目覆盖

### 素材

```http
POST /cgi-bin/media/upload?access_token=ACCESS_TOKEN&type=TYPE
GET  /cgi-bin/media/get?access_token=ACCESS_TOKEN&media_id=MEDIA_ID
POST /cgi-bin/media/uploadimg?access_token=ACCESS_TOKEN
POST /cgi-bin/material/add_material?access_token=ACCESS_TOKEN&type=TYPE
POST /cgi-bin/material/add_news?access_token=ACCESS_TOKEN
POST /cgi-bin/material/get_material?access_token=ACCESS_TOKEN
POST /cgi-bin/material/del_material?access_token=ACCESS_TOKEN
POST /cgi-bin/material/batchget_material?access_token=ACCESS_TOKEN
GET  /cgi-bin/material/get_materialcount?access_token=ACCESS_TOKEN
```

当前覆盖：临时素材、图文图片、永久素材大部分已覆盖。

修正状态（2026-07-01）：`wechat_permanent_media` 已暴露 `news` 类型，`add` 操作通过 `articles` 参数调用官方 `material/add_news`，并将工具层 camelCase 字段映射为官方 snake_case 请求字段。

分页约束（2026-07-02 复核）：`POST /cgi-bin/material/batchget_material` 请求体 `count` 为必填，官方取值范围 `1~20`。工具层默认使用官方上限 `20`。

### 草稿与发布

```http
POST /cgi-bin/draft/add?access_token=ACCESS_TOKEN
POST /cgi-bin/draft/get?access_token=ACCESS_TOKEN
POST /cgi-bin/draft/delete?access_token=ACCESS_TOKEN
POST /cgi-bin/draft/batchget?access_token=ACCESS_TOKEN
GET  /cgi-bin/draft/count?access_token=ACCESS_TOKEN
POST /cgi-bin/freepublish/submit?access_token=ACCESS_TOKEN
POST /cgi-bin/freepublish/get?access_token=ACCESS_TOKEN
POST /cgi-bin/freepublish/delete?access_token=ACCESS_TOKEN
```

当前覆盖：`wechat_draft` 对应草稿 add/get/delete/list/count；`wechat_publish` 对应 submit/get/list/delete。

修正状态（2026-07-05）：`POST /cgi-bin/freepublish/delete` 用于删除已发布文章，操作不可逆；请求体使用 `article_id` 和可选 `index`。历史代码中将 delete 参数误写为 `publish_id`，已修正为 `article_id`，并在 CLI/REST 删除路径增加显式确认保护。

分页约束（2026-07-02 复核）：

- `POST /cgi-bin/draft/batchget` 请求体 `count` 为必填，官方取值范围 `1~20`；`no_content` 可选，`1` 表示不返回 `content` 字段，`0` 表示正常返回，官方默认 `0`。工具层默认使用官方上限 `count=20`，并默认发送 `no_content=1`，避免用户未指定参数时拉取多篇完整正文导致 MCP 响应过大。
- `POST /cgi-bin/freepublish/batchget` 请求体 `count` 为必填，官方取值范围 `1~20`；`no_content` 可选，`1` 表示不返回 `content` 字段，`0` 表示正常返回，官方默认 `0`。工具层默认使用官方上限 `count=20`，并默认发送 `no_content=1`。

### 用户与标签

```http
GET  /cgi-bin/user/get?access_token=ACCESS_TOKEN&next_openid=NEXT_OPENID
GET  /cgi-bin/user/info?access_token=ACCESS_TOKEN&openid=OPENID&lang=zh_CN
POST /cgi-bin/user/info/batchget?access_token=ACCESS_TOKEN
POST /cgi-bin/user/info/updateremark?access_token=ACCESS_TOKEN
POST /cgi-bin/tags/create?access_token=ACCESS_TOKEN
POST /cgi-bin/tags/get?access_token=ACCESS_TOKEN
POST /cgi-bin/tags/update?access_token=ACCESS_TOKEN
POST /cgi-bin/tags/delete?access_token=ACCESS_TOKEN
POST /cgi-bin/user/tag/get?access_token=ACCESS_TOKEN
POST /cgi-bin/tags/members/batchtagging?access_token=ACCESS_TOKEN
POST /cgi-bin/tags/members/batchuntagging?access_token=ACCESS_TOKEN
POST /cgi-bin/tags/getidlist?access_token=ACCESS_TOKEN
```

当前覆盖：用户列表、信息、批量信息、备注、标签创建/查询/更新/删除/批量打标/取消打标/标签下用户。

未覆盖：`tags/getidlist`（获取用户身上的标签列表）。

### 菜单

```http
POST /cgi-bin/menu/create?access_token=ACCESS_TOKEN
GET  /cgi-bin/menu/get?access_token=ACCESS_TOKEN
GET  /cgi-bin/menu/delete?access_token=ACCESS_TOKEN
POST /cgi-bin/menu/addconditional?access_token=ACCESS_TOKEN
POST /cgi-bin/menu/delconditional?access_token=ACCESS_TOKEN
GET  /cgi-bin/get_current_selfmenu_info?access_token=ACCESS_TOKEN
```

当前覆盖：基础菜单、个性化菜单、当前自定义菜单配置。

### 客服消息

发送接口：

```http
POST /cgi-bin/message/custom/send?access_token=ACCESS_TOKEN
```

同页还包含：

```http
POST /cgi-bin/message/custom/typing?access_token=ACCESS_TOKEN
GET  /cgi-bin/customservice/getkflist?access_token=ACCESS_TOKEN
POST /customservice/kfaccount/add?access_token=ACCESS_TOKEN
POST /customservice/kfaccount/update?access_token=ACCESS_TOKEN
POST /customservice/kfaccount/del?access_token=ACCESS_TOKEN
POST /customservice/kfaccount/uploadheadimg?access_token=ACCESS_TOKEN&kf_account=KFACCOUNT
```

当前覆盖：`wechat_customer_service` 支持多种 send_* action。

修正状态（2026-07-01）：`get_records` 已改为官方 `POST /customservice/msgrecord/getmsglist`，请求字段使用 `starttime` / `endtime` / `msgid` / `number`，并按官方返回的 `recordlist` 归一化为工具内部 `records`。

限制状态（2026-07-05 官方复核）：客服管理、客服消息、聊天记录接口的官方适用范围为小程序可调，公众号/服务号需“仅认证”；生产返回 `65400 please enable new custom service` 时属于微信后台能力未启用/未生效，不是 endpoint 或字段错误。工具层应返回可操作诊断：启用新版客服/客服消息能力并等待生效后重试。

### 模板消息

```http
POST /cgi-bin/template/api_set_industry?access_token=ACCESS_TOKEN
GET  /cgi-bin/template/get_industry?access_token=ACCESS_TOKEN
POST /cgi-bin/template/api_add_template?access_token=ACCESS_TOKEN
GET  /cgi-bin/template/get_all_private_template?access_token=ACCESS_TOKEN
POST /cgi-bin/template/del_private_template?access_token=ACCESS_TOKEN
POST /cgi-bin/message/template/send?access_token=ACCESS_TOKEN
```

当前覆盖：发送、设置行业、添加模板、获取全部模板、删除模板、获取行业。

修正状态（2026-07-05）：官方 `sendTemplateMessage` 请求字段为 `template_id`，不是 `templateId`；已将工具入参 `templateId` 映射为出站 `template_id`。官方返回模板列表字段为 `template_id` / `primary_industry` / `deputy_industry`，工具内部做兼容归一化。

限制状态（2026-07-05 官方复核）：模板消息官方适用范围为“服务号（仅认证）”。生产返回 `48001 api unauthorized` 时应提示当前公众号未开通/未授权模板消息能力，不能靠代码重试修复。

### 带参数二维码

```http
POST /cgi-bin/qrcode/create?access_token=ACCESS_TOKEN
GET  /cgi-bin/showqrcode?ticket=TICKET
```

请求体使用 `action_name` 和 `action_info.scene`；临时二维码 `expire_seconds` 最大 `2592000` 秒；永久整型场景值 `scene_id` 官方限制为 `1-100000`。

限制状态（2026-07-05 官方复核）：该接口官方适用范围为“服务号（仅认证）”。生产返回 `48001 api unauthorized` 时应提示账号类型/认证/权限问题。

### 长信息与短链

旧 `Account_Management/URL_Shortener.html` 已升级，新官方文档为“长信息与短链”：

```http
POST /cgi-bin/shorten/gen?access_token=ACCESS_TOKEN
POST /cgi-bin/shorten/fetch?access_token=ACCESS_TOKEN
```

`gen` 请求体使用 `long_data` / `expire_seconds`，其中 `long_data` 不超过 4KB，`expire_seconds` 最大 `2592000` 秒；返回 `short_key`，不再返回旧实现假定的 `short_url`。`fetch` 使用 `short_key` 还原 `long_data`。

限制状态（2026-07-05 官方复核）：服务号需“仅认证”。生产返回 `48001 api unauthorized` 时应提示认证/权限限制。

### 订阅通知 / 一次性订阅

官方文档区分两个接口：

服务号订阅通知：

```http
POST /cgi-bin/message/subscribe/bizsend?access_token=ACCESS_TOKEN
```

请求体使用 `template_id`，不是 `templateId`。

公众号一次性订阅消息：

```http
POST /cgi-bin/message/template/subscribe?access_token=ACCESS_TOKEN
```

修正状态（2026-07-01）：`wechat_subscribe_msg` 当前实现为服务号订阅通知，调用官方 `POST /cgi-bin/message/subscribe/bizsend`；工具入参保留 `templateId` 兼容用户习惯，但出站请求字段映射为官方 `template_id`，小程序跳转字段映射为 `miniprogram.appid` / `miniprogram.pagepath`。

### 群发

```http
POST /cgi-bin/message/mass/sendall?access_token=ACCESS_TOKEN
POST /cgi-bin/message/mass/send?access_token=ACCESS_TOKEN
POST /cgi-bin/message/mass/delete?access_token=ACCESS_TOKEN
POST /cgi-bin/message/mass/preview?access_token=ACCESS_TOKEN
POST /cgi-bin/message/mass/get?access_token=ACCESS_TOKEN
POST /cgi-bin/message/mass/speed/get?access_token=ACCESS_TOKEN
POST /cgi-bin/message/mass/speed/set?access_token=ACCESS_TOKEN
POST /cgi-bin/media/uploadnews?access_token=ACCESS_TOKEN
POST /cgi-bin/media/uploadimg?access_token=ACCESS_TOKEN
```

当前覆盖：按标签群发、按 OpenID 群发、删除、预览。

未覆盖：群发状态查询、群发速度获取/设置、上传图文消息素材 `uploadnews`。

迁移范围决策（2026-07-01）：本次 Cloudflare 迁移优先保证现有 MCP 工具 contract 正确并迁移运行时；`tags/getidlist`、模板消息 set/add、群发 get/speed/uploadnews 等缺口记录为后续能力扩展，不作为 G001 必需新增 API。

### 数据统计

当前项目使用的 datacube endpoint：

```http
POST /datacube/getusersummary
POST /datacube/getusercumulate
POST /datacube/getupstreammsg
POST /datacube/getinterfacesummary
POST /datacube/getinterfacesummaryhour
```

修正状态（2026-07-05）：生产正式调用发现 `/cgi-bin/datacube/...` 返回 HTTP 404；datacube 族 endpoint 应为根路径 `/datacube/...`，并使用 POST JSON body `begin_date` / `end_date`。

图文统计旧接口：

```http
POST /datacube/getarticlesummary
POST /datacube/getarticletotal
POST /datacube/getuserread
POST /datacube/getusershare
```

官方复核状态（2026-07-05）：微信服务号文档已标注上述旧图文统计接口“已停止维护，请尽快使用下面新接口进行替换”；生产返回 `47009 this api is offline, please use the new api` 时应迁移到新版发表内容统计接口，不应继续调用旧接口。

新版发表内容统计接口：

```http
POST /datacube/getarticleread
POST /datacube/getarticleshare
POST /datacube/getbizsummary
POST /datacube/getarticletotaldetail
```

限制：`getarticleread` / `getarticleshare` / `getbizsummary` 数据存储起始时间为 `2025-11-01`，日期范围最长 30 天；`getarticletotaldetail` 日期范围仅支持 1 天，每篇文章仅统计发表日起 30 天内数据。官方适用范围为“公众号/服务号仅认证”。

这些命名与公众号数据统计接口族一致；若后续增加 schema 级参数校验，必须重新打开官方数据统计文档确认日期范围和返回字段。

## 文档维护规则

- 不再使用“覆盖 95%+”“100% 覆盖”“完整覆盖所有核心 API”等未经官方逐项核验的表述。
- 新增或修改工具前，先在本文件补充官方 endpoint、请求字段、返回字段和限制。
- 如果当前代码与官方 contract 不一致，先在 OpenSpec 或 issue 中记录偏差，再实现修复。
- Cloudflare 迁移参考：`openspec/changes/migrate-to-cloudflare-workers/wechat-official-api-contract.md` 与本文件内容应保持一致。
