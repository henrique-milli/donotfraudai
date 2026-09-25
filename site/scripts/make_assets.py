import subprocess, os
G = os.path.expanduser("~/Downloads/WhatsApp Video 2026-09-25 at 10.40.07.mp4")
A = os.path.expanduser("~/Downloads/WhatsApp Video 2026-09-25 at 11.27.07.mp4")
OUT = "/Users/ayman/Documents/donotfraudai/site/assets/img/"
CROP_G = "crop=576:1228:0:52,scale=576:1232"
CROP_A = "crop=576:1212:0:68,scale=576:1232"

# Personal data on the ID card is pixelated before anything is published.
FRONT = [(28,298,160,40),(400,300,150,40),(234,362,316,244),(46,372,188,200)]
BACK = [(36,330,500,165),(56,522,456,86)]
ATTACK = [(20,200,540,380)]  # whole card as shown on the laptop screen

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
shot("pad-front.jpg", G, 12.6, [], CROP_G)
shot("pad-back.jpg", G, 31.6, [], CROP_G)
shot("chip.jpg", G, 38.0, [], CROP_G)
shot("face.jpg", G, 54.0, [], CROP_G)
shot("face-done.jpg", G, 59.4, [], CROP_G)
shot("score.jpg", G, 67.4, [], CROP_G)
shot("allset.jpg", G, 99.6, [], CROP_G)
shot("start.jpg", G, 1.0, [], CROP_G)
shot("attack-screen.jpg", A, 5.4, ATTACK, CROP_A)
shot("attack-detected.jpg", A, 10.35, [], CROP_A)
