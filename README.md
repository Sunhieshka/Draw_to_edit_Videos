# Draw to Edit — Seedance

Generate videos with Seedance (2.5, 2.0, 2.0 fast, 2.0 mini), then **draw on a frame** to mark an object and
modify / replace / remove / add something in the video.

## How draw-to-edit works

1. Generate a video (or import a public video URL). Under **Reference media**, use the ＋ tiles to add reference media.
   Limits depend on the model: **Seedance 2.5** takes up to 30 images, 10 videos (30s combined) and 10 audio clips
   (30s combined). **Seedance 2.0 / fast / mini** take 9 images, 3 videos and 3 audio clips. Refer to them in the prompt as "Image 1", "Video 1", "Audio 1".
   Files are hosted in your TOS bucket. Without TOS, images are sent inline and video/audio uploads are disabled.
2. Pick it from the library; thumbnails are extracted from the video. Click one (or scrub the player and
   press **Use current player frame**).
3. Draw over the object with the brush, box or circle tools.
4. Pick an action (Remove / Replace / Modify / Add). The prompt box starts with a template for that action;
   type the rest of your instructions straight into it. For **Replace** and **Add** you can also upload an image of
   the object, which is sent as a second `reference_image`.
5. **Edit video** sends one task to Seedance with:
   - `content`: the prompt (text), the original video (`role: reference_video`), and the marked frame
     (`role: reference_image`, sent as a JPEG data URL)
   - `omni_reference_task_type="edit"`, `ratio="adaptive"`, `duration=-1`

The UI and backend both check that the reference video is 4–30s long and that the prompt contains
"edit the video", "add", "delete/remove" or "modify/replace/change".
Edit results (with live progress) appear in the same edit box under the **Edit video** button, and
also in the library. **Edit this result** lets you keep editing an output.

## Real people: asset library

Seedance blocks real human faces passed as plain URLs or images. Human images and videos must first go into
the ModelArk **private asset library**. They are then referenced as `asset://<asset-id>`.

- **Asset library panel** (left column)
  - **Real people** lists your verified `LivenessFace` groups. **Verify** starts a liveness check: send the link
    *only* to the person being verified, then click **Check result** to get their group. Uploads are face-matched
    to that person.
  - **Virtual** lists `AIGC` groups for fictional characters and objects. **＋** creates a new group.
  - Upload an image or video (hosted in your TOS bucket and passed to `CreateAsset` as a 1-hour pre-signed URL),
    or paste a public `https://` URL. Assets show `Processing` until they become `Active`.
  - Click Active assets to select them as references.
- **Generate**: selected assets are sent as `reference_image` / `reference_video` with `asset://` URLs. In the
  prompt, refer to them as "Image 1", "Image 2", "Video 1", and so on.
- **Draw to edit**: turn on **"Video contains real people — use asset library"**. The source video, the marked frame
  and the object image are then uploaded to the selected group. The app waits until they are Active, then sends the
  edit with `asset://` references. The video's asset ID is cached per group, so later edits reuse it.
  For Replace and Add, you can also choose a selected image asset as the object.

Asset management uses signed OpenAPI calls (`ark.ap-southeast-1.byteplusapi.com`, version `2024-01-01`) with
IAM **AK/SK**, which are separate from `ARK_API_KEY`. The Entry tier allows 3 `CreateAsset` calls per minute.

## Setup

Add your keys to `backend/.env` (see `backend/.env.example`):

```
ARK_API_KEY=your-key-here          # video generation
BYTEPLUS_AK=...                    # asset library (IAM access key with ArkFullAccess)
BYTEPLUS_SK=...
ARK_PROJECT=default
TOS_BUCKET_NAME=...                # hosts local uploads for the asset library
TOS_REGION=ap-southeast-1
```

### Backend (FastAPI + byteplus-python-sdk-v2), port 8000

```bash
cd backend
python3 -m venv venv          # already created
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend (React + Vite + Tailwind), port 5173

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` and `/media` to the backend.

## Notes

- Finished videos are downloaded to `backend/media/`, so the browser can read frames from them
  (a remote URL would block reading pixels from the canvas because of CORS).
- The **remote** Seedance output URL is what gets sent as the reference video. These URLs expire after
  about 24 hours, so edit videos while they are fresh, or re-import them from a URL you host yourself.
- Imported videos must be reachable from the public internet, because the Seedance API fetches them itself.
