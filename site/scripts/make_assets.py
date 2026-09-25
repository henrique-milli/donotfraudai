import subprocess, os
# Source screen recording of a genuine session, passed in by path; never committed.
G = os.environ["DNF_SOURCE_VIDEO"]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "img") + os.sep
CROP_G = "crop=576:1228:0:52,scale=576:1232"

# Pixelated before anything is published: the whole card (personal data), the check banner and the
# presenter panels with the capture engine's live readouts.
FRONT = [(0,280,576,400),(0,960,576,240)]
BACK = [(36,330,500,165),(56,522,456,86),(0,600,576,90),(0,960,576,240)]
FACE = [(0,975,576,225)]

def pix(regions):
    if not regions: return "null"
    parts = ["[0:v]" + CROPS + ",split=%d" % (len(regions)+1) + "".join("[s%d]" % i for i in range(len(regions)+1)) + ";"]
    for i,(x,y,w,h) in enumerate(regions, start=1):
        parts.append("[s%d]crop=%d:%d:%d:%d,scale=%d:%d:flags=neighbor,scale=%d:%d:flags=neighbor[p%d];" % (i,w,h,x,y,max(1,w//14),max(1,h//14),w,h,i))
    cur = "s0"
    for i,(x,y,w,h) in enumerate(regions, start=1):
        nxt = "o%d" % i
        parts.append("[%s][p%d]overlay=%d:%d[%s];" % (cur,i,x,y,nxt))
        cur = nxt
    return "".join(parts)[:-1].rsplit("[%s]" % cur, 1)[0]

def shot(name, src, t, regions, crop):
    global CROPS
    CROPS = crop
    if regions:
        fc = pix(regions)
        cmd = ["ffmpeg","-v","error","-y","-ss",str(t),"-i",src,"-frames:v","1","-filter_complex",fc,"-q:v","3",OUT+name]
    else:
        cmd = ["ffmpeg","-v","error","-y","-ss",str(t),"-i",src,"-frames:v","1","-vf",crop,"-q:v","3",OUT+name]
    subprocess.run(cmd, check=True)
    print(name)

shot("doc-front.jpg", G, 10.2, FRONT, CROP_G)
shot("doc-back.jpg", G, 27.5, BACK, CROP_G)
shot("chip.jpg", G, 38.0, [], CROP_G)
shot("face.jpg", G, 54.0, FACE, CROP_G)
shot("face-done.jpg", G, 59.4, FACE, CROP_G)
shot("score.jpg", G, 67.4, [], CROP_G)
shot("allset.jpg", G, 99.6, [], CROP_G)
shot("start.jpg", G, 1.0, [], CROP_G)
