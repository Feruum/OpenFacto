# Openfacto — чистый знак концепта 7

Пользователь выбрал исходные три формы из v7 и отклонил нейросеть/стрелку v8. Эта итерация возвращает выбранную геометрию без добавочных элементов. Статус: очищенная растровая концепция на просмотр, не векторный мастер. Встроенный imagegen. Геометрия и заливки могут немного отличаться от исходника из-за генерации. Цветовые ориентиры: #26183E и #B8D5E8; третий цвет полной айдентики v7 — #F3EEE4. Код фронтенда не менялся.

![Чистый знак](symbol-v7-clean.png)

## Промпт

```text
Use case: logo-brand
Asset type: faithful cleanup of selected Openfacto concept 7 symbol, no redesign.
Input image: the user's attached cropped emblem is the EXACT EDIT TARGET and authoritative geometry reference.
Primary request: reproduce and clean up ONLY the exact three-piece abstract symbol in the input. User explicitly rejected redesigns and added neural networks. PRESERVE the same three shapes, their silhouette, proportions, positions, orientation and spacing as closely as possible. Remove only the cropped fragment of white wordmark at the right edge. Recenter the complete three-piece symbol on a uniform flat deep-plum background with generous negative space. No text, no board, no palette labels.
Geometry invariants: upper right a rounded-corner quarter-disc with flat vertical left side, flat horizontal bottom and convex arc from upper left toward lower right; left a detached curved sector with vertical right edge and oblique lower edge, exactly as reference; bottom a separate semicircle with horizontal flat baseline and convex upper arc, exactly as reference. These are THREE disconnected solid pieces around an empty open center. Match reference asymmetrical spacing and top-right shape height. Do not rearrange into a symmetric pinwheel. Do not introduce cutouts, extra lobes, notches, holes, strokes or outlines. Keep the empty negative-space center completely empty.
Polish ONLY: make arc contours smooth, corners consistent, edges crisp and optical alignment clean while maintaining the reference's actual design.
Colors: solid Glacier Blue #B8D5E8 symbol on solid Deep Plum #26183E background. Exactly two flat fills, no lighting, gradient, texture, shadow, glow, 3D or subtle photographic shading. Square image, symbol centered occupying roughly 55 percent image width. Original vector-friendly mark as a clean raster study.
ABSOLUTELY NO network nodes, connections, arrows, vector diagrams, brain, chat bubbles, wordmark, lettering or additional decorative elements. This is exact selected logo cleanup, not a new logo exploration.
```

