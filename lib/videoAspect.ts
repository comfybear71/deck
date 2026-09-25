// FORCED 16:9 – do not change unless intentionally switching formats
//
// Every Deck video engine (Grok, Siray Wan 3.0, MiniMax H3, Comfy LTX)
// must come out widescreen. Two things made clips come out square
// (2026-09-25):
// 1. Siray Seedream plate stills were requested at 2048x2048, and
//    Siray video used `aspect_ratio: "adaptive"`, so a square plate
//    became a square clip.
// 2. Grok image-to-video and H3 copy the start image's shape by default.
//    Passing `aspect_ratio: "16:9"` to Grok on a square plate *stretches*
//    it (xAI docs: "it will override this and stretch the image").
//
// So the lock is: request 16:9 explicitly where the API has a knob, and
// pad any non-16:9 start frame into a 1920x1080 black frame before it is
// sent, so no engine ever sees a square/portrait image to copy or stretch.
// Pads only — never crops (keeps heads/hats) and never distorts.
// Kept free of `sharp` so client components can import engine constants.
export const FORCED_VIDEO_ASPECT_RATIO = "16:9" as const;
export const FORCED_FRAME_WIDTH = 1920;
export const FORCED_FRAME_HEIGHT = 1080;

