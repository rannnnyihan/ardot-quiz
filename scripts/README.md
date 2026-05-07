# 分享图自动版本号机制

## 我要解决什么问题？

> 换了 `img/` 下的分享图，但微信里转发卡片缩略图还是旧图。

原因：微信爬虫会**强缓存** `og:image`。如果 URL 没变，它不会重新抓。

所以我们需要：**图片内容一变，URL 自动跟着变。**

## 它是怎么工作的？

1. **`scripts/sync-share-version.mjs`**
   读 `img/share-cover.png` 和 6 张角色图（`picasso.png` / `hara.png` / `mondrian.png` / `kusama.png` / `gogh.png` / `monet.png`）的 `mtime + size`，hash 出一段 8 位指纹。

2. 把指纹写入 `quiz-h5.html` 和 `share-d1.html ~ share-d6.html` 中所有指向分享图的 URL，作为 `?v=xxxxxxxx`。
   - `og:image` / `og:image:secure_url`
   - `twitter:image`
   - `itemprop="image"`
   - `<link rel="image_src">`
   - `<meta name="thumbnail">`
   - 内嵌 JS 中 `posterImg` / `roleMetaImgName` 拼装出的 URL

3. 图片没改 → 指纹不变 → 文件 0 diff，幂等。
   图片一改 → 指纹自动变 → 微信下次抓到的 URL 不同 → 触发重抓。

## 你需要做什么？

### ① 一次性安装 git 钩子（在新机器/克隆后做一次）

```bash
bash scripts/install-hooks.sh
```

之后**每次 `git commit` 自动跑同步脚本**，把变更后的 HTML 也加进同一个提交。

### ② 日常工作流（你只需要做这一件事）

**直接换图，提交，推送。完事。**

```bash
# 比如把毕加索的角色分享图换成新版
cp ~/Downloads/new-picasso.png img/picasso.png

git add img/picasso.png
git commit -m "更新毕加班索分享图"
git push
```

提交时 pre-commit 钩子会自动：
- 重新计算 `picasso.png` 的指纹（旧 `dd361e6f` → 新指纹）
- 把 `quiz-h5.html` 和 `share-d1.html` 里所有指向 `picasso.png` 的 URL 版本号同步更新
- 把这些被自动改的 HTML 一并 `git add` 加入本次提交

部署到 EdgeOne 之后，微信爬虫读到新 URL，缩略图自动换。

### ③ 没装 hook / 想手动跑一次

```bash
node scripts/sync-share-version.mjs
```

幂等，可以重复跑。

## 相关图与对应分享场景

| 图 | 用途 |
|---|---|
| `img/share-cover.png` | 首页 / 答题中分享卡片 |
| `img/picasso.png` | 结果 d1（草稿太多的毕加班索）分享卡片 |
| `img/hara.png` | 结果 d2（还在抠图的原研灾）分享卡片 |
| `img/mondrian.png` | 结果 d3（对不齐的蒙得里不安）分享卡片 |
| `img/kusama.png` | 结果 d4（复制到崩溃的草间弥死）分享卡片 |
| `img/gogh.png` | 结果 d5（风格断片的梵稿）分享卡片 |
| `img/monet.png` | 结果 d6（睡莲迁移失败的莫奈何）分享卡片 |

> 角色立绘和分享角色图共用同一个文件，所以换图是"立绘和分享卡片同时换"。

## 注意事项 & FAQ

- **微信爬虫会缓存几小时**：即便 URL 已经变了，部分场景下仍会沿用上次抓到的 og 信息。最快 1~2 小时后生效。
- **EdgeOne CDN**：如果直接覆盖图片但路径不变，CDN 边缘可能命中旧版几分钟。`?v=...` 同时也帮我们绕过浏览器缓存。
- **不要手改 `?v=` 后面的值**：会被脚本下次 commit 时改回正确的指纹。
