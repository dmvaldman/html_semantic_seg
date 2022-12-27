const { chromium } = require('playwright')
const { createCanvas, loadImage } = require("canvas")
const fs = require('fs');

// TODO
// make JSON dump
// add clickable field
// Support all input types as classes
// classes for specific elements: image would have caption, URL, etc. button would have text, URL, etc.
// support for article and section
// use clip to determine caption tag for nearby images

// const url = 'https://www.wsj.com'
// const url = 'https://en.wikipedia.org/wiki/Machine_learning'
const url = 'https://github.com/openai'
// const url = 'https://www.amazon.com/'

// Size of the browser viewport and final images
const viewportHeight = 720
const viewportWidth = 1280

// Categories of semantic content
const LABELS = {
    'TEXT': 0,
    'CODE': 1,
    'LINK': 2,
    'IMAGE': 3,
    'VIDEO': 4,
    'AUDIO': 5,
    'BUTTON': 6,
    'INPUT': 7,
    'FORM': 8,
    'QUOTE': 9,
    'CUSTOM': 10,
    'ICON': 11,
    'HEADER': 12,
    'SUBMIT': 13,
    'FOOTER': 14,
    'NAV': 15
};

const COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'];

function drawRect(canvas, x, y, w, h, text, color) {
    const ctx = canvas.getContext('2d');

    // Fill
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1.0;

    // Stroke
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.globalAlpha = 1.0;

    // Text
    if (text){
        ctx.font = '12px Arial';
        ctx.fillText(text, x, y);
    }
}

function saveCanvas(canvas, savePath){
    const buffer = canvas.toBuffer('image/png')
    fs.writeFileSync(savePath, buffer)
}

function clipViewport(canvas, viewportHeight, index, save=false, savePath=''){
    let context = canvas.getContext('2d')
    let data = context.getImageData(0, viewportHeight * index, canvas.width, viewportHeight)
    const canvasViewport = createCanvas(canvas.width, viewportHeight)
    const ctx = canvasViewport.getContext('2d')
    ctx.putImageData(data, 0, 0)
    const buffer = canvasViewport.toBuffer('image/png')

    if (save) saveCanvas(canvasViewport, savePath)

    return buffer
}

function drawSegments(canvas, segmentGroups, save=false, savePath=''){
    let offset = 0
    for (let segments of segmentGroups) {
        for (let segment of segments) {
            if (segment.label == LABELS.CUSTOM) continue
            let bbox = segment.bbox
            let description = segment.description
            let color = COLORS[segment.label]
            let text = Object.keys(LABELS)[segment.label]
            drawRect(canvas, bbox.x, bbox.y + offset, bbox.width, bbox.height, text, color)
        }
        offset += viewportHeight
    }

    if (save) saveCanvas(canvas, savePath)
}

(async () => {
    const browser = await chromium.launch({headless: true})
    // const browser = await chromium.launch({headless: false, devtools: true})
    const page = await browser.newPage()

    // sanitize url for a file path by replacing periods and slashes
    const imgPathBase = 'screenshots/' + url.replace(/(^\w+:|^)\/\//, '').replace(/\//g, '_').replace(/\./g, '_') + '/'

    await page.setViewportSize({width: viewportWidth, height: viewportHeight})
    await page.goto(url)

    // Seems this was necessary for fonts and stuff, otherwise sizes gets messed up
    await page.waitForTimeout(5000)

    // Crawl the webpage, building "leaf node" segments that have semantic content
    // Return a list of lists of segments, where each list of segments is a viewport
    let segmentGroups = await page.evaluate(([viewportWidth, viewportHeight, LABELS]) => {

        class Segment {
            // Leaf node segment of "semantic content"
            constructor(el, offset=0){
                this.el = el
                this.bbox = this.getBoundingBox(el)
                this.label = this.getLabel(el)
                this.description = this.getDescription(el)
                // this.isClickable = this.isClickable(el)

                if (offset !== 0)
                    this.bbox.y += offset
            }
            isClickable(el){
                let hasClickEvent = (el.getAttribute('onclick') != null || el.getAttribute('href') != null)
                // let hasClickEvent = (window.getEventListeners && window.getEventListeners(el)['click'])
                if (hasClickEvent) return true
                else if (el.parentElement) hasClickEvent = this.isClickable(el.parentElement)
                return hasClickEvent
            }
            getBoundingBox(el){
                // return el.getClientRects()[0]
                return el.getBoundingClientRect()
            }
            getLabel(el){
                const data = {
                    'tagName': el.tagName.toUpperCase(),
                    'parentTagName': el.parentElement.tagName.toUpperCase(),
                    'classlist': el.classList,
                    'hasText': el.textContent.trim() !== '',
                    'el': el
                }

                // Classify the semantic content of the node
                if (this.isHeader(data)) return LABELS.HEADER
                if (this.isCode(data)) return LABELS.CODE
                if (this.isQuote(data)) return LABELS.QUOTE
                if (this.isList(data)) return LABELS.LIST
                if (this.isButton(data)) return LABELS.BUTTON
                if (this.isLink(data)) return LABELS.LINK
                if (this.isInput(data)) return LABELS.INPUT
                if (this.isText(data)) return LABELS.TEXT
                if (this.isImage(data)) return LABELS.IMAGE
                if (this.isIcon(data)) return LABELS.ICON
                if (this.isCustom(data)) return LABELS.CUSTOM

                // Nodes whose labels are their tagname
                if (['VIDEO', 'AUDIO', 'FORM', 'NAV', 'FOOTER'].includes(data.tagName))
                    return LABELS[data.tagName]

                return data.tagName
            }
            isButton(data){
                // Should go after a link check
                let tagName = data.tagName
                let classlist = data.classlist
                let role = data.el.getAttribute('role')
                let hasClickEvent = (window.getEventListeners && window.getEventListeners(data.el)['click'])
                let isInputButton = tagName == 'INPUT' && data.el.getAttribute('type') == 'button'
                return tagName == 'BUTTON' || role == 'button' || isInputButton || (tagName == 'A' && (classlist.contains('btn') || classlist.contains('button'))) || hasClickEvent
            }
            isInput(data){
                let tagName = data.tagName
                return tagName == 'INPUT' || tagName == 'SELECT' || tagName == 'OPTION' || tagName == 'TEXTAREA'
            }
            isCustom(data){
                let tagName = data.tagName
                return window.customElements.get(tagName.toLowerCase())
            }
            isText(data){
                let tagName = data.tagName
                let hasText = data.hasText
                return hasText && (tagName == 'P' || tagName == 'SPAN' || tagName == 'ABBR' || tagName == 'LABEL' || tagName == 'DIV'|| tagName == 'LI')
            }
            isLink(data){
                let tagName = data.tagName
                let parentTagName = data.parentTagName
                let classlist = data.classlist

                let linkNotButton = (tagName == 'A' && !classlist.contains('btn') && !classlist.contains('button'))
                let parentIsLink = (parentTagName == 'A' && (tagName == 'P' || tagName == 'SPAN' || tagName == 'ABBR' || tagName == 'ADDRESS'))
                let citeElement = (tagName == 'CITE')
                return linkNotButton || parentIsLink || citeElement
            }
            isHeader(data){
                let tagName = data.tagName
                let parentTagName = data.parentTagName
                let hasText = data.hasText

                let isHeader = (hasText && (tagName == 'H1' || tagName == 'H2' || tagName == 'H3' || tagName == 'H4' || tagName == 'H5' || tagName == 'H6'))
                let isParentHeader = (hasText && (parentTagName == 'H1' || parentTagName == 'H2' || parentTagName == 'H3' || parentTagName == 'H4' || parentTagName == 'H5' || parentTagName == 'H6'))
                return isHeader || isParentHeader
            }
            isCode(data){
                let tagName = data.tagName
                return (tagName == 'PRE' || tagName == 'CODE')
            }
            isQuote(data){
                let tagName = data.tagName
                return (tagName == 'BLOCKQUOTE')
            }
            isImage(data){
                // todo: check if SVG or IMG
                let tagName = data.tagName
                let el = data.el
                if (tagName == 'IMG' || (tagName == 'SVG' && this.bbox.height * this.bbox.width > minImageArea))
                    return true
                else {
                    let isBackgroundImage = (window.getComputedStyle(el).backgroundImage.slice(0,3) == 'url')
                    if (isBackgroundImage){
                        let url = window.getComputedStyle(el).backgroundImage.slice(4, -1).replace(/"/g, "")
                        let filetype = url.split('.').pop()
                        if (['jpg', 'png', 'gif', 'jpeg', 'webp'].includes(filetype))
                            return true
                    }
                    return false
                }
            }
            isIcon(data){
                let tagName = data.tagName
                let el = data.el
                let isSVG = (tagName == 'SVG')
                let isSmall = (this.bbox.height * this.bbox.width < minImageArea)
                let isKBD = (tagName == 'KBD')

                if (isKBD || isSVG && isSmall){
                    return true
                }
                else {
                    let isBackgroundImage = (window.getComputedStyle(el).backgroundImage.slice(0,3) == 'url')
                    if (isBackgroundImage){
                        let url = window.getComputedStyle(el).backgroundImage.slice(4, -1).replace(/"/g, "")
                        let filetype = url.split('.').pop()
                        if (filetype == 'svg' || filetype.startsWith('data'))
                            return true
                    }
                    else return false
                }
            }
            isList(data){
                let tagName = data.tagName
                return (tagName == 'TABLE' || tagName == 'UL' || tagName == 'OL'|| tagName == 'DL')
            }
            getDescription(el){
                if (el.getAttribute('aria-label'))
                    return el.getAttribute('aria-label')
                if (el.getAttribute('alt'))
                    return el.getAttribute('alt')
                if (el.getAttribute('role'))
                    return el.getAttribute('role')
                return ''
            }
            getSegmentFromPoint(viewportHeight){
                let centerX = this.bbox.x + this.bbox.width / 2
                let centerY = this.bbox.y + this.bbox.height / 2

                // Scroll page so element is in view in increments of `viewportHeight`
                let offset = 0
                while (this.bbox.y > offset + viewportHeight)
                    offset += viewportHeight

                let scrollY = window.scrollY
                if (scrollY != offset) window.scrollTo(0, offset)

                let el = document.elementFromPoint(centerX, centerY - offset)

                if (el === null) return false

                return new Segment(el, offset)
            }
            replaceWithSegmentFromPoint(viewportHeight){
                let segment = this.getSegmentFromPoint(viewportHeight)
                if (segment === false) return false

                this.el = segment.el
                this.bbox = segment.bbox
                this.label = segment.label

                return true
            }
            serialize(){
                return {
                    'label': this.label,
                    'bbox': {
                        'x': this.bbox.x,
                        'y': this.bbox.y,
                        'width': this.bbox.width,
                        'height': this.bbox.height
                    },
                    'description': this.description
                }
            }
        }

        class Segments {
            // Segments is an iterable collection of Segment objects
            constructor(segments){
                this.segments = segments || []
            }
            add(segment){
                this.segments.push(segment)
                return this
            }
            sort(){
                this.segments.sort((a, b) => a.bbox.y - b.bbox.y)
                return this
            }
            [Symbol.iterator]() {
                let index = -1;
                let data  = this.segments;

                return {
                    next: () => ({ value: data[++index], done: !(index in data) })
                };
            };
            uniquify(){
                let uniqueSegments = []
                let seen = new Set()
                for (let segment of this.segments){
                    let key = segment.bbox.x + '_' + segment.bbox.y + '_' + segment.bbox.width + '_' + segment.bbox.height
                    if (!seen.has(key)){
                        uniqueSegments.push(segment)
                        seen.add(key)
                    }
                }
                return new Segments(uniqueSegments)
            }
            replaceWithSegmentFromPoint(){
                for (let segment of this.segments){
                    segment.replaceWithSegmentFromPoint(viewportHeight)
                }
                return this
            }
            serialize(){
                let serializedSegments = []
                for (let segment of this.segments){
                    serializedSegments.push(segment.serialize())
                }
                return serializedSegments
            }
        }

        class SegmentGroups {
            // SegmentGroups is an iterable collection of SegmentGroup objects, broken down by viewport height essentially
            constructor(segments){
                this.groups = []
                this.segments = segments || new Segments()
            }
            group(viewportHeight){
                let group = new Segments()
                let offset = 0

                for (let segment of this.segments){
                    if (segment.bbox.y < offset + viewportHeight){
                        segment.bbox.y -= offset
                        group.add(segment)
                    }
                    else {
                        this.groups.push(group)
                        group = new Segments()
                        offset += viewportHeight
                    }
                }
                this.groups.push(group)
                return this
            }
            serialize(){
                let serializedSegmentGroups = []
                for (let group of this.groups){
                    serializedSegmentGroups.push(group.serialize())
                }
                return serializedSegmentGroups
            }
        }

        // Types of DOM nodes
        const invisible_nodes = ['HEAD', 'META', 'STYLE', 'NOSCRIPT', 'SCRIPT', 'TEMPLATE', 'CENTER', 'DATA', 'EMBED', '<!--...-->', 'BDI']
        const skipped_nodes = ['IFAME', 'BR', 'B', 'I', 'STRONG', 'EM', 'LEGEND']
        const leaf_nodes = ['SVG', 'IMG', 'PRE', 'CODE', 'TEXTAREA', 'INPUT', 'BLOCKQUOTE']
        const leaf_nodes_composite = ['TABLE', 'UL', 'OL', 'DL', 'P', 'BUTTON', 'FORM', 'FOOTER', 'NAV']

        const minImageArea = 800

        // Breadth-first traversal of DOM tree
        let els = [document.body]
        let leaves = new Segments()
        while (els.length > 0) {
            let el = els.shift()

            if (el.nodeType == Node.TEXT_NODE && el.textContent.trim() !== ''){
                leaves.add(new Segment(el.parentElement))
                continue
            }

            if (el.nodeType !== Node.ELEMENT_NODE)
                continue

            let nodeName = el.nodeName.toUpperCase()

            // Ignore elements that are not visible
            if (invisible_nodes.includes(nodeName) || skipped_nodes.includes(nodeName))
                continue

            let computedStyle = window.getComputedStyle(el)
            if (computedStyle.visibility == 'hidden' || computedStyle.visibility == 'none' || computedStyle.opacity === '0' || el.checkVisibility() === false)
                continue

            // Atomic elements that we want to also double click into
            if (leaf_nodes_composite.includes(nodeName))
                leaves.add(new Segment(el))

            // Atomic elements
            if (leaf_nodes.includes(nodeName)){
                leaves.add(new Segment(el))
                continue
            }

            // Other leaf elements: background images and text
            if (el.childElementCount == 0){
                if (el.textContent.trim() !== '')
                    leaves.add(new Segment(el))

                if (window.getComputedStyle(el).backgroundImage.slice(0,3) == 'url')
                    leaves.add(new Segment(el))

                continue
            }

            els.push(...el.childNodes)
        }

        // let uniqueSegments = leaves.uniquify().replaceWithSegmentFromPoint().sort()
        let uniqueSegments = leaves.uniquify().sort()
        // let uniqueSegments = leaves.sort()

        let segmentGroups = new SegmentGroups(uniqueSegments).group(viewportHeight)

        return segmentGroups.serialize()
    }, [viewportWidth, viewportHeight, LABELS])

    // Generate full-page screenshot
    let imgPath = imgPathBase + 'full.png'
    await page.evaluate(() => {window.scrollTo(0, 0)})
    await page.screenshot({path: imgPath, fullPage: true})
    let img = await loadImage(imgPath)

    // Create two canvases for screenshot, one for raw and one for annotated
    const canvasFull = createCanvas(img.width, img.height)
    const ctxFull = canvasFull.getContext('2d')
    ctxFull.drawImage(img, 0, 0, img.width, img.height);

    const canvasAnnotated = createCanvas(img.width, img.height)
    const ctxAnnotated = canvasAnnotated.getContext('2d')
    ctxAnnotated.drawImage(img, 0, 0, img.width, img.height);

    // Draw bounding boxes on annotated canvas
    let imgPathFullAnnotated = imgPathBase + 'full_annotated.png'
    drawSegments(canvasAnnotated, segmentGroups, save=true, imgPathFullAnnotated)

    // Split up full-page screenshot into segments according to full-page scrolling of viewport
    for (let index in segmentGroups){
        let imgPath = imgPathBase + index + '.png'
        let imgPathAnnotated = imgPathBase + index + '_annotated.png'

        clipViewport(canvasFull, viewportHeight, index, save=true, savePath=imgPath)
        clipViewport(canvasAnnotated, viewportHeight, index, save=true, savePath=imgPathAnnotated)
    }

    await browser.close()
})();