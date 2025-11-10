// --- Simple vec3 utilities
function vec3(x, y, z) { return {x, y, z}; }
function flattenCoords(coords) {
    const arr = [];
    for (let c of coords) arr.push(c.x, c.y, c.z);
    return new Float32Array(arr);
}

// --- Camera and matrices
import {mat4} from "https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/esm/index.js";
import earcut from 'https://cdn.jsdelivr.net/npm/earcut@2.2.4/+esm';

const entities = [];

const mouse = {x: 0, y: 0};
let setup = false;

window.onload = function() {
    const canvas = document.getElementById("canvas");

    const lodSlider = document.getElementById("lod-slider");
    const lodHeader = document.getElementById("lod-header");
    const lodDescription = document.getElementById("lod-description");
    const lodLegend = document.getElementById("lod-legend");
    const lodLeftButton = document.getElementById("lod-left-button");
    const lodRightButton = document.getElementById("lod-right-button");

    const minIndex = parseInt(lodSlider.getAttribute("min"));
    const maxIndex = parseInt(lodSlider.getAttribute("max"));

    document.addEventListener('mousemove', e => {
        mouse.x = e.x;
        mouse.y = e.y;
    })

    const gl = canvas.getContext("webgl", { depth: true });
    if (!gl) {
        const children = canvas.parentElement.children;
        while (children.length) {
            const child = children[0];
            child.remove();
        }
        return;
    }

    // resize canvas to device pixel ratio
    function resizeCanvas() {
        const ratio = window.devicePixelRatio || 1;
        const w = Math.floor(canvas.clientWidth * ratio);
        const h = Math.floor(canvas.clientHeight * ratio);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            gl.viewport(0, 0, w, h);
        }
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // --- Shaders
    const vsSource = `
// Vertex Shader
attribute vec3 aPosition;

uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;

varying float vDistance;  // distance from camera
varying float vHeight;    // vertical height (y)
varying vec3 vPosition;    // vertical height (y)

void main(void) {
    // Transform the vertex position
    vec4 worldPos = vec4(aPosition, 1.0);
    vec4 viewPos = uViewMatrix * worldPos;

    // Pass height and distance to the fragment shader
    vDistance = length(viewPos.xyz);
    vPosition = worldPos.xyz;
    vHeight = aPosition.y;

    gl_Position = uProjectionMatrix * viewPos;
}
  `;

    const fsSource = `
// Fragment Shader
precision mediump float;

uniform vec4 uColor;
uniform vec4 uClipPlane; // e.g. (0.0, 1.0, 0.0, -height)

varying float vDistance;
varying float vHeight;
varying vec3 vPosition;

void main(void) {
    // if (dot(uClipPlane.xyz, vPosition) - uClipPlane.w > cos((vPosition.x + vPosition.z) / 20.0 - 5.0) * 6.0)
    if (dot(uClipPlane.xyz, vPosition) - uClipPlane.w > 0.0)
        discard;
        
    // gl_FragColor = vec4(uColor.rgb * ((vHeight + vDistance + 80.0) / 180.0), uColor.a);
    gl_FragColor = vec4(uColor.rgb, uColor.a);
}
  `;

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(shader));
        return shader;
    }

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    // --- Locations
    const aPosition = gl.getAttribLocation(program, "aPosition");
    const uProjectionMatrix = gl.getUniformLocation(program, "uProjectionMatrix");
    const uViewMatrix = gl.getUniformLocation(program, "uViewMatrix");
    const uClipPlane = gl.getUniformLocation(program, "uClipPlane");
    const uBaseColor = gl.getUniformLocation(program, "uBaseColor");
    const uColor = gl.getUniformLocation(program, "uColor");

    const colors = {
        red: [1.0, 0.0, 0.0, 1.0],
        green: [0.0, 1.0, 0.0, 1.0],
        blue: [0.0, 0.0, 1.0, 1.0],
        white: [1.0, 1.0, 1.0, 1.0],
        black: [0.0, 0.0, 0.0, 1.0],
        light: [0.90, 0.90, 0.90, 1.0],
        gray: [0.5, 0.5, 0.5, 1.0],
    };

    let highlightKey = null;

    fetch("/data.json")
        .then(res => res.json())
        .then(json => {
            json.forEach(entry => {
                const coords = entry.coords.map(coord => vec3(coord[0], coord[1], coord[2]))
                if (entry.type === 'wall') {
                    createWall(entry.id, entry.entity, coords, entry.properties);
                }
                else if (entry.type === 'floor') {
                    createFloor(entry.id, entry.entity, coords, entry.properties);
                }
            });

            index = 0;
        });

    let index = -1;
    let draw = (element) => null;
    let heightPass = { current: -10, target: -10 };

    let offset = 0.00000;

    function createWall(id, entity, coords, properties) {
        offset -= 0.00001;
        coords = coords.map(coord => vec3(coord.x + offset, coord.y + offset, coord.z + offset));

        // Triangles
        const triVerts = flattenCoords([
            coords[0], coords[1], coords[2],
            coords[0], coords[2], coords[3]
        ]);

        // Lines (edges)
        const lineVerts = flattenCoords([
            coords[0], coords[1],
            coords[1], coords[2],
            coords[2], coords[3],
            coords[3], coords[0]
        ]);

        const triBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, triBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, triVerts, gl.STATIC_DRAW);

        const lineBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, lineVerts, gl.STATIC_DRAW);

        entities.push({
            id,
            entity,
            triBuffer,
            lineBuffer,
            triCount: 6,
            lineCount: 8,
            properties,
            height: coords.map(coord => coord.y).reduce((a, b) => Math.min(a, b))
        });
    }

    function createFloor(id, entity, coords, properties) {
        offset -= 0.00001;
        coords = coords.map(coord => vec3(coord.x + offset, coord.y + offset, coord.z + offset));

        // Convert coords to flat array for earcut: [x0,y0, x1,y1, ...] (ignore y for triangulation)
        const flatCoords = [];
        for (let c of coords) {
            flatCoords.push(c.x, c.z); // use XZ plane for floor
        }

        // Triangulate (returns array of indices)
        const triangles = earcut(flatCoords);

        // Build triangle vertices
        const triVerts = [];
        for (let idx of triangles) {
            const c = coords[idx];
            triVerts.push(c);
        }

        // Build line vertices for outline
        const lineVerts = [];
        for (let i = 0; i < coords.length; i++) {
            lineVerts.push(coords[i], coords[(i + 1) % coords.length]);
        }

        const triBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, triBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, flattenCoords(triVerts), gl.STATIC_DRAW);

        const lineBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, flattenCoords(lineVerts), gl.STATIC_DRAW);

        entities.push({
            id,
            entity,
            triBuffer,
            lineBuffer,
            triCount: triVerts.length,
            lineCount: lineVerts.length,
            properties,
            height: coords.map(coord => coord.y).reduce((a, b) => Math.min(a, b))
        });
    }

    let zoom = 0.24;
    let lookAt = [49,16,-40];
    const camera = {
        current: [214.23043399621798, 86.23831398360436, 141.35060303308813],
        target: [214.23043399621798, 86.23831398360436, 141.35060303308813],
    };

    function render() {
        const topScroll = (window.pageYOffset || document.scrollTop)  - (document.clientTop || 0);
        const scroll = topScroll - canvas.offsetTop + window.innerHeight * 0.3333;

        if (scroll > 0 && !setup) {
            setup = true;
            heightPass.target = 40;
        }

        if (window.innerWidth < 475) {
            zoom = 0.54;
            lookAt = [49,30,-40];
        }
        else if (window.innerWidth < 700) {
            zoom = 0.39;
            lookAt = [49,28,-40];
        }
        else if (window.innerWidth < 1000) {
            zoom = 0.32;
            lookAt = [49,22,-40];
        }
        else if (window.innerWidth < 1400) {
            zoom = 0.27;
            lookAt = [49,20,-40];
        }
        else {
            zoom = 0.25;
            lookAt = [49,15,-40];
        }

        const oldIndex = index;
        index = parseInt(lodSlider.value);
        if (index !== oldIndex) {
            lodLeftButton.disabled = index === minIndex;
            lodRightButton.disabled = index === maxIndex;

            switch (index) {
                case 0: {
                    lodHeader.innerText = "Een voorbeeld casus met MiniBIM";
                    lodDescription.innerHTML = "Dit BIM-model is een voorbeeld casus waarin de informatiebehoefte is beantwoord met MiniBIM. MiniBIM maakt onderscheid tussen <i>Gebieden</i>, <i>Ruimten</i>, <i>Buitenruimten</i>, <i>Bouwwerken</i>, en <i>Terreinen</i>. In dit voorbeeld lichten we Gebieden verder toe.<br/><br/><div class=\"muted\" style=\"text-align: center\">Gebruik de knoppen aan weerszijde om te navigeren.</div>";
                    draw = (element) => {
                        if (element.properties["ObjectType"] !== "Gebied") {
                            return null;
                        }
                        return { key: null, color: colors.light };
                    };

                    setLegend([]);
                    break;
                }
                case 1: {
                    lodHeader.innerText = "Gebieden in MiniBIM";
                    lodDescription.innerHTML = "Gebieden zijn zones met een beoogd gebruik binnen dat gebied. Met MiniBIM zijn deze gebieden te categoriseren op bijvoorbeeld de <i><em>Afnemer</em></i>.";

                    const mappings = {};
                    for (let element of entities) {
                        if (element.properties["ObjectType"] !== "Gebied") {
                            continue;
                        }
                        const property = element.properties["Afnemer"];
                        if (!property) {
                            continue;
                        }
                        mappings[property] = true;
                    }

                    const keys = Object.keys(mappings).sort((l, r) => l.localeCompare(r));
                    for (let i = 0; i < keys.length; i++) {
                        const key = keys[i];
                        mappings[key] = generateColor(i, keys.length);
                    }

                    draw = (element) => {
                        if (element.properties["ObjectType"] !== "Gebied") {
                            return null;
                        }
                        const property = element.properties["Afnemer"];
                        if (!property) {
                            return null;
                        }

                        return { key: property, color: mappings[property] };
                    };

                    setLegend(Object.keys(mappings).map(key => {
                        return { key, color: mappings[key] };
                    }));

                    break;
                }
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                case 8:
                case 9:
                case 10:
                case 11: {
                    const entries = ["GebiedsSoort", "GebiedsType", "Gebruiksbestemming", "Orientatie", "Segment", "Programma", "WoningType", "Bepalingsmethode", "BouwwerkNummer", "EenheidNummer"];

                    const description = entries.map((entry, idx) => {
                        if (index - 2 === idx) {
                            entry = "<em>" + entry + "</em>";
                        }
                        entry = "<i>" + entry + "</i>";
                        if (idx === entries.length - 1) {
                            entry = "en " + entry;
                        }
                        return entry;
                    }).reduce((prev, curr) => prev + ", " + curr);

                    const entry = entries[index - 2];

                    lodHeader.innerText = "Gebieden in MiniBIM";
                    lodDescription.innerHTML = "Maar ook op informatie zoals o.a. " + description + ".";

                    const mappings = {};
                    for (let element of entities) {
                        if (element.properties["ObjectType"] !== "Gebied") {
                            continue;
                        }
                        const property = element.properties[entry];
                        if (!property) {
                            continue;
                        }
                        mappings[property] = true;
                    }

                    const keys = Object.keys(mappings).sort((l, r) => l.localeCompare(r));
                    for (let i = 0; i < keys.length; i++) {
                        const key = keys[i];
                        mappings[key] = generateColor(i, keys.length);
                    }

                    draw = (element) => {
                        if (element.properties["ObjectType"] !== "Gebied") {
                            return null;
                        }
                        const property = element.properties[entry];
                        if (!property) {
                            return null;
                        }

                        return { key: property, color: mappings[property] };
                    };

                    if (index === 11) {
                        setLegend([]);
                    }
                    else {
                        setLegend(Object.keys(mappings)
                            .sort((l, r) => l.localeCompare(r))
                            .map(key => {
                                return {key, color: mappings[key]};
                            }));
                    }

                    break;
                }
                case 12: {
                    lodHeader.innerText = "Gebieden in MiniBIM";
                    lodDescription.innerHTML = "Combineer categorieën zoals <i><em>Afnemer</em></i> en <i><em>Bepalingsmethode</em></i>, met informatie zoals oppervlakten en volumes voor verdere analyse en besluitvorming.";

                    const mappings = {};
                    for (let element of entities) {
                        if (element.properties["ObjectType"] !== "Gebied") {
                            continue;
                        }
                        const property1 = element.properties["Afnemer"];
                        const property2 = element.properties["Bepalingsmethode"];
                        if (!property1 || !property2) {
                            continue;
                        }
                        mappings[property1 + " - " + property2] = true;
                    }

                    const keys = Object.keys(mappings).sort((l, r) => l.localeCompare(r));
                    for (let i = 0; i < keys.length; i++) {
                        const key = keys[i];
                        mappings[key] = generateColor(i, keys.length);
                    }

                    draw = (element) => {
                        if (element.properties["ObjectType"] !== "Gebied") {
                            return null;
                        }
                        const property1 = element.properties["Afnemer"];
                        const property2 = element.properties["Bepalingsmethode"];
                        if (!property1 || !property2) {
                            return null;
                        }

                        const property = property1 + " - " + property2;
                        return { key: property, color: mappings[property] };
                    };

                    setLegend(Object.keys(mappings)
                        .sort((l, r) => l.localeCompare(r))
                        .map(key => {
                            return { key, color: mappings[key] };
                        }));

                    break;
                }
            }
        }

        camera.target[0] = (lookAt[0] + 1000.0 * Math.cos(0.6 + mouse.x / 6000)) * 0.3;
        camera.target[1] = (lookAt[1] + 1000.0 * Math.sin(0.2 + mouse.y / 6000)) * 0.3;
        camera.target[2] = (lookAt[2] + 1000.0 * Math.sin(0.6 + mouse.x / 6000)) * 0.2;

        camera.current[0] = (camera.target[0] + camera.current[0] * 4.0) / 5.0;
        camera.current[1] = (camera.target[1] + camera.current[1] * 4.0) / 5.0;
        camera.current[2] = (camera.target[2] + camera.current[2] * 4.0) / 5.0;

        heightPass.current = (heightPass.target + heightPass.current * 10.0) / 11.0;

        // --- Projection
        const projectionMatrix = mat4.create();
        mat4.perspective(projectionMatrix, zoom, canvas.width/canvas.height, 1.0, 1000);

        const viewMatrix = mat4.create();
        mat4.lookAt(viewMatrix, camera.current, lookAt, [0,1,0]);

        // --- Render loop
        gl.depthRange(0.0, 1.0);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1.0, 1.0);

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);

        gl.clearColor(1.0,1.0,1.0,1.0);

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix4fv(uProjectionMatrix, false, projectionMatrix);
        gl.uniformMatrix4fv(uViewMatrix, false, viewMatrix);
        gl.uniform4fv(uClipPlane, [0, 1, 0, heightPass.current]);

        // Pass 1: solid walls

        gl.disable(gl.DEPTH_TEST);
        for (let e of entities) {
            if (e.properties["ObjectType"] !== "Gebied") {
                continue;
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, e.triBuffer);
            gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(aPosition);
            gl.uniform4fv(uColor, colors.light);
            gl.drawArrays(gl.TRIANGLES, 0, e.triCount);
        }

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.lineWidth(1.0);

        for (let e of entities) {
            const value = draw(e);
            if (value === null) {
                continue;
            }

            let { key, color } = value;
            if (!color) {
                continue;
            }

            if (highlightKey && key !== highlightKey) {
                continue;
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, e.triBuffer);
            gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(aPosition);
            gl.uniform4fv(uColor, color);
            gl.drawArrays(gl.TRIANGLES, 0, e.triCount);
        }

        // Pass 2: outlines
        // gl.disable(gl.DEPTH_TEST);
        // gl.uniform4fv(uClipPlane, [-0.3, 1, -0.3, 100]);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);

        for (let e of entities) {
            const value = draw(e);
            if (value === null) {
                continue;
            }

            let { key, color } = value;
            if (!color) {
                continue;
            }

            if (highlightKey) {
                if (key !== highlightKey) {
                    continue;
                }
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, e.lineBuffer);
            gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
            gl.uniform4fv(uColor, [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6, 1.0]); // Black outline
            gl.drawArrays(gl.LINES, 0, e.lineCount);
        }

        gl.depthFunc(gl.LESS);
        gl.enable(gl.DEPTH_TEST);

        requestAnimationFrame(render);
    }

    render();

    function setLegend(entries) {
        lodLegend.innerHTML = null;

        if (entries && entries.length) {
            entries.forEach(entry => appendLegendEntry(entry.color, entry.key));
            lodLegend.style.display = "flex";
        }
        else {
            lodLegend.style.display = "none";
        }
    }

    function appendLegendEntry(color, name) {
        const container = document.createElement("div");
        container.setAttribute("style", "display: flex; flex-direction: row; gap: 0.25rem; align-items: center; cursor: default; padding: 0.25rem 0.5rem;");

        const swatch = document.createElement("div");
        swatch.setAttribute("style", "width: 0.8rem; height: 0.8rem; border-radius: 3px; border: 1px solid var(--gray-dark); background-color: " + toRgba(color));
        container.append(swatch);

        const text = document.createElement("div");
        text.setAttribute("style", "font-size: 0.7rem; color: var(--gray);");
        text.innerText = name;
        container.append(text);

        container.addEventListener('mouseenter', e => {
            highlightKey = name;
        });
        container.addEventListener('mouseleave', e => {
            highlightKey = null;
        });

        lodLegend.append(container);
    }

    function generateColor(idx, total) {
        const index = (idx / total) * 360.0;

        var r = index <= 60 ? 1.0 : index <= 120 ? 1.0 - (index - 60.0) / 60.0 : index <= 240 ? 0.0 : index <= 300 ? (index - 240.0) / 60.0 : 1.0;
        var g = index <= 60 ? index / 60.0 : index <= 180 ? 1.0 : index <= 240 ? (240.0 - index) / 60.0 : 0.0;
        var b = index <= 120 ? 0.0 : index <= 180 ? (index - 120.0) / 60.0 : index <= 300 ? 1.0 : 1.0 - (index - 360.0) / 60.0;

        return [
            r,
            g,
            b,
            1.0
        ];
    }

    function toRgba(color) {
        return "rgba(" + (color[0] * 255) + ", " + (color[1] * 255) + ", " + (color[2] * 255) + ", " + color[3] + ")";
    }

};