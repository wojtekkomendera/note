(() => {
"use strict";

const state = {
    boardId: null,
    blocks: new Map(),
    zoom: 1,
    saveTimers: new Map(),
    drag: null,
    resize: null
};

const $ = id => document.getElementById(id);
const boardCanvas = $("boardCanvas");

async function api(action, options = {}) {

    const url =
        `api.php?action=${encodeURIComponent(action)}${options.query || ""}`;

    const cfg = {
        method: options.method || "GET",
        headers: {}
    };

    if (options.body instanceof FormData) {
        cfg.body = options.body;
    } else if (options.body !== undefined) {
        cfg.headers["Content-Type"] = "application/json";
        cfg.body = JSON.stringify(options.body);
    }

    const response = await fetch(url,cfg);

    const data = await response
        .json()
        .catch(() => ({
            ok:false,
            error:"Nieprawidłowa odpowiedź serwera."
        }));

    if (!response.ok || !data.ok) {
        throw new Error(
            data.error || `HTTP ${response.status}`
        );
    }

    return data;
}

function status(text) {
    $("saveStatus").textContent = "● " + text;
}

function debounceSave(blockId, patch, delay = 450) {

    if (state.saveTimers.has(blockId)) {
        clearTimeout(state.saveTimers.get(blockId));
    }

    status("Zapisywanie…");

    const timer = setTimeout(async () => {

        try {

            await api("update_block",{
                method:"POST",
                body:{
                    id:blockId,
                    ...patch
                }
            });

            status("Zapisano");

        } catch(error) {

            console.error(error);
            status("Błąd zapisu");
        }

    },delay);

    state.saveTimers.set(blockId,timer);
}

async function loadBoards(selectId = null) {

    const data = await api("boards");

    const select = $("boardSelect");
    const list = $("boardList");

    select.innerHTML = "";
    list.innerHTML = "";

    data.boards.forEach(board => {

        const option = document.createElement("option");

        option.value = board.id;
        option.textContent = board.name;

        select.appendChild(option);

        const item = document.createElement("div");

        item.className =
            "board-item" +
            (
                String(board.id) ===
                String(selectId || state.boardId)
                    ? " active"
                    : ""
            );

        const icon = document.createElement("span");
        icon.textContent = "▦";

        const name = document.createElement("span");
        name.textContent = board.name;

        item.append(icon,name);

        item.onclick = () => selectBoard(Number(board.id),false);

        list.appendChild(item);
    });

    if (!data.boards.length) {
        return;
    }

    const id = Number(
        selectId ||
        state.boardId ||
        data.boards[0].id
    );

    select.value = id;

    await selectBoard(id,false);
}

async function selectBoard(id, refreshList = true) {

    const data = await api("board",{
        query:`&id=${encodeURIComponent(id)}`
    });

    state.boardId = id;
    state.blocks.clear();

    boardCanvas.innerHTML = "";

    $("boardTitle").textContent = data.board.name;

    $("boardMeta").textContent =
        `${data.blocks.length} elementów`;

    if (refreshList) {
        await loadBoards(id);
        return;
    }

    document
        .querySelectorAll(".board-item")
        .forEach(item => item.classList.remove("active"));

    document
        .querySelectorAll(".board-item")
        .forEach(item => {

            if (item.textContent.trim() === data.board.name) {
                item.classList.add("active");
            }
        });

    data.blocks.forEach(renderBlock);

    status("Gotowe");
}

function renderBlock(block) {

    block.id = Number(block.id);
    block.x = Number(block.x);
    block.y = Number(block.y);
    block.w = Number(block.w);
    block.h = Number(block.h);
    block.z_index = Number(block.z_index);

    state.blocks.set(block.id,block);

    const element = document.createElement("article");

    element.className = "block";
    element.dataset.id = block.id;

    element.style.left = block.x + "px";
    element.style.top = block.y + "px";
    element.style.width = block.w + "px";
    element.style.height = block.h + "px";
    element.style.zIndex = block.z_index || 1;

    const head = document.createElement("div");

    head.className = "block-head";

    const title = document.createElement("span");

    title.className = "block-title";
    title.textContent =
        block.title ||
        labelFor(block.type);

    const actions = document.createElement("div");

    actions.className = "block-actions";

    const edit = document.createElement("button");
    edit.textContent = "✎";
    edit.title = "Zmień tytuł";
    edit.className = "edit-title";

    const duplicate = document.createElement("button");
    duplicate.textContent = "⧉";
    duplicate.title = "Duplikuj";
    duplicate.className = "duplicate-block";

    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.title = "Usuń";
    remove.className = "delete-block";

    actions.append(edit,duplicate,remove);
    head.append(title,actions);

    const body = document.createElement("div");
    body.className = "block-body";

    buildBody(body,block);

    const resize = document.createElement("div");
    resize.className = "resize-handle";

    element.append(head,body,resize);

    head.addEventListener("mousedown",event => {

        if (event.target.closest("button")) {
            return;
        }

        startDrag(event,element,block);
    });

    resize.addEventListener(
        "mousedown",
        event => startResize(event,element,block)
    );

    edit.onclick = () => editTitle(block,element);

    duplicate.onclick = () =>
        duplicateBlock(block);

    remove.onclick = () =>
        deleteBlock(block.id,element);

    element.addEventListener("mousedown",() => {

        document
            .querySelectorAll(".block.selected")
            .forEach(item =>
                item.classList.remove("selected")
            );

        element.classList.add("selected");
    });

    boardCanvas.appendChild(element);
}

function buildBody(body,block) {

    if (block.type === "note") {

        const editor = document.createElement("div");

        editor.className = "note-editor";
        editor.contentEditable = "true";
        editor.innerHTML = block.content || "";

        editor.addEventListener("input",() => {

            debounceSave(
                block.id,
                {content:editor.innerHTML}
            );
        });

        body.appendChild(editor);

        return;
    }

    if (block.type === "checklist") {

        let items = [];

        try {
            items = JSON.parse(block.content || "[]");
        } catch {
            items = [];
        }

        if (!Array.isArray(items)) {
            items = [];
        }

        items.forEach(item => {

            if (typeof item === "string") {
                item = {
                    text:item,
                    done:false
                };
            }

            const row = document.createElement("div");
            row.className = "check-row";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = !!item.done;

            const text = document.createElement("span");
            text.contentEditable = "true";
            text.textContent = item.text || "";

            text.classList.toggle(
                "done",
                checkbox.checked
            );

            checkbox.onchange = () => {

                text.classList.toggle(
                    "done",
                    checkbox.checked
                );

                saveChecklist(body,block);
            };

            text.oninput = () =>
                saveChecklist(body,block);

            row.append(checkbox,text);

            body.appendChild(row);
        });

        const add = document.createElement("button");

        add.className = "secondary-btn";
        add.style.marginTop = "8px";
        add.textContent = "＋ Pozycja";

        add.onclick = () => {

            const current = readChecklist(body);

            current.push({
                text:"Nowa pozycja",
                done:false
            });

            block.content =
                JSON.stringify(
                    current,
                    null,
                    0
                );

            debounceSave(
                block.id,
                {content:block.content},
                0
            );

            body.innerHTML = "";
            buildBody(body,block);
        };

        body.appendChild(add);

        return;
    }

    if (block.type === "sheet") {

        buildSheet(body,block);

        return;
    }

    if (block.type === "link") {

        const wrap = document.createElement("div");
        wrap.className = "link-card";

        const link = document.createElement("a");

        link.href = block.content || "#";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent =
            block.title ||
            block.content ||
            "Otwórz link";

        const url = document.createElement("div");

        url.className = "link-url";
        url.textContent = block.content || "";

        wrap.append(link,url);
        body.appendChild(wrap);

        return;
    }

    if (block.type === "image") {

        body.classList.add("image-body");

        if (block.content) {

            const img = document.createElement("img");

            img.src = block.content;
            img.alt = block.title || "Zdjęcie";

            body.appendChild(img);

        } else {

            body.textContent =
                "Brak zdjęcia — dodaj plik.";
        }

        return;
    }

    if (block.type === "file") {

        const wrap = document.createElement("div");
        wrap.className = "file-card";

        const icon = document.createElement("div");
        icon.className = "file-icon";
        icon.textContent = "📎";

        const info = document.createElement("div");

        const link = document.createElement("a");

        link.href = block.content || "#";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent =
            block.title ||
            "Otwórz plik";

        info.appendChild(link);
        wrap.append(icon,info);

        body.appendChild(wrap);
    }
}

function readChecklist(body) {

    return [...body.querySelectorAll(".check-row")]
        .map(row => ({
            text:
                row.querySelector("span")?.textContent || "",
            done:
                !!row.querySelector("input")?.checked
        }));
}

function saveChecklist(body,block) {

    const items = readChecklist(body);

    block.content =
        JSON.stringify(items);

    debounceSave(
        block.id,
        {content:block.content}
    );
}

function parseSheet(content) {

    try {

        const data = JSON.parse(content || "");

        if (
            data &&
            Array.isArray(data.rows) &&
            data.rows.length
        ) {
            return data;
        }

    } catch {}

    return {
        rows: [
            ["","A","B","C","D"],
            ["1","","","",""],
            ["2","","","",""],
            ["3","","","",""],
            ["4","","","",""],
            ["5","","","",""]
        ]
    };
}

function buildSheet(body,block) {

    const data = parseSheet(block.content);

    const wrap = document.createElement("div");
    wrap.className = "sheet-wrap";

    const toolbar = document.createElement("div");
    toolbar.className = "sheet-toolbar";

    const addRow = document.createElement("button");
    addRow.className = "secondary-btn";
    addRow.textContent = "＋ Wiersz";

    const addCol = document.createElement("button");
    addCol.className = "secondary-btn";
    addCol.textContent = "＋ Kolumna";

    toolbar.append(addRow,addCol);

    const table = document.createElement("table");
    table.className = "sheet";

    const tbody = document.createElement("tbody");

    data.rows.forEach((row,rowIndex) => {

        const tr = document.createElement("tr");

        row.forEach((cell,colIndex) => {

            const td =
                rowIndex === 0
                    ? document.createElement("th")
                    : document.createElement("td");

            td.contentEditable =
                rowIndex !== 0;

            td.textContent = cell ?? "";

            if (rowIndex !== 0) {
                td.dataset.row = rowIndex;
                td.dataset.col = colIndex;

                td.addEventListener("input",() => {

                    const rows = readSheet(table);

                    block.content =
                        JSON.stringify(
                            {rows:rows}
                        );

                    debounceSave(
                        block.id,
                        {content:block.content}
                    );
                });
            }

            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);

    addRow.onclick = () => {

        const rows = readSheet(table);
        const cols = rows[0]?.length || 5;

        const row = [];

        row.push(
            String(rows.length)
        );

        for (let i=1;i<cols;i++) {
            row.push("");
        }

        rows.push(row);

        block.content =
            JSON.stringify({rows});

        debounceSave(
            block.id,
            {content:block.content},
            0
        );

        body.innerHTML = "";
        buildSheet(body,block);
    };

    addCol.onclick = () => {

        const rows = readSheet(table);

        rows.forEach((row,index) => {

            if (index === 0) {
                row.push(
                    String.fromCharCode(
                        65 + row.length - 1
                    )
                );
            } else {
                row.push("");
            }
        });

        block.content =
            JSON.stringify({rows});

        debounceSave(
            block.id,
            {content:block.content},
            0
        );

        body.innerHTML = "";
        buildSheet(body,block);
    };

    wrap.append(toolbar,table);
    body.appendChild(wrap);
}

function readSheet(table) {

    return [...table.rows].map(row =>
        [...row.cells].map(cell =>
            cell.textContent
        )
    );
}

function fieldsFor(type) {

    if (type === "note") {

        return [
            {
                name:"title",
                label:"Tytuł",
                type:"input",
                value:"Nowa notatka"
            }
        ];
    }

    if (type === "checklist") {

        return [
            {
                name:"title",
                label:"Tytuł",
                type:"input",
                value:"Nowa lista"
            },
            {
                name:"content",
                label:"Pozycje — jedna w wierszu",
                type:"textarea",
                value:""
            }
        ];
    }

    if (type === "sheet") {

        return [
            {
                name:"title",
                label:"Tytuł arkusza",
                type:"input",
                value:"Nowy arkusz"
            }
        ];
    }

    if (type === "link") {

        return [
            {
                name:"title",
                label:"Nazwa",
                type:"input",
                value:"Link"
            },
            {
                name:"content",
                label:"Adres URL",
                type:"input",
                value:"https://"
            }
        ];
    }

    if (
        type === "image" ||
        type === "file"
    ) {

        return [
            {
                name:"title",
                label:"Nazwa elementu",
                type:"input",
                value:
                    type === "image"
                        ? "Zdjęcie"
                        : "Plik"
            }
        ];
    }

    return null;
}

async function createBlock(type) {

    const fields = fieldsFor(type);

    if (!fields) {
        return;
    }

    openModal(
        labelFor(type),
        fields,
        async values => {

            let content = values.content || "";

            if (type === "checklist") {

                content =
                    JSON.stringify(
                        (values.content || "")
                            .split(/\r?\n/)
                            .map(text => text.trim())
                            .filter(Boolean)
                            .map(text => ({
                                text,
                                done:false
                            }))
                    );
            }

            if (type === "sheet") {

                content =
                    JSON.stringify({
                        rows:[
                            ["","A","B","C","D"],
                            ["1","","","",""],
                            ["2","","","",""],
                            ["3","","","",""],
                            ["4","","","",""],
                            ["5","","","",""]
                        ]
                    });
            }

            const created =
                await api(
                    "create_block",
                    {
                        method:"POST",
                        body:{
                            board_id:state.boardId,
                            type,
                            title:
                                values.title ||
                                labelFor(type),
                            content
                        }
                    }
                );

            if (
                type === "image" ||
                type === "file"
            ) {

                const uploaded =
                    await uploadForBlock(
                        created.id,
                        type,
                        values.title
                    );

                if (!uploaded) {

                    await api(
                        "delete_block",
                        {
                            method:"POST",
                            body:{
                                id:created.id
                            }
                        }
                    );

                    return;
                }
            }

            await selectBoard(
                state.boardId,
                true
            );
        }
    );
}

function openModal(title,fields,onSubmit) {

    $("modalTitle").textContent = title;

    const container = $("modalFields");

    container.innerHTML = "";

    fields.forEach(field => {

        const group =
            document.createElement("div");

        group.className = "form-group";

        const label =
            document.createElement("label");

        label.textContent = field.label;

        let input;

        if (field.type === "textarea") {
            input =
                document.createElement("textarea");
        } else {
            input =
                document.createElement("input");
            input.type = "text";
        }

        input.name = field.name;
        input.value = field.value || "";

        group.append(label,input);
        container.appendChild(group);
    });

    $("modal").classList.remove("hidden");

    $("modalForm").onsubmit = async event => {

        event.preventDefault();

        const values = {};

        new FormData(event.target)
            .forEach((value,key) => {
                values[key] = value;
            });

        try {

            await onSubmit(values);
            closeModal();

        } catch(error) {

            alert(error.message);
        }
    };
}

function closeModal() {

    $("modal").classList.add("hidden");
    $("modalForm").reset();
}

async function uploadForBlock(
    blockId,
    type,
    title
) {

    return new Promise(resolve => {

        const input = $("fileInput");

        input.accept =
            type === "image"
                ? "image/*"
                : ".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.zip,.docx,.xlsx";

        input.value = "";

        input.onchange = async () => {

            if (!input.files[0]) {
                resolve(false);
                return;
            }

            const form =
                new FormData();

            form.append(
                "block_id",
                String(blockId)
            );

            form.append(
                "file",
                input.files[0]
            );

            form.append(
                "title",
                title || ""
            );

            try {

                await api(
                    "upload",
                    {
                        method:"POST",
                        body:form
                    }
                );

                resolve(true);

            } catch(error) {

                alert(error.message);
                resolve(false);
            }
        };

        input.click();
    });
}

function startDrag(event,element,block) {

    event.preventDefault();

    state.drag = {
        element,
        block,
        startX:event.clientX,
        startY:event.clientY,
        origX:block.x,
        origY:block.y
    };

    document.addEventListener(
        "mousemove",
        dragMove
    );

    document.addEventListener(
        "mouseup",
        dragEnd,
        {once:true}
    );
}

function dragMove(event) {

    if (!state.drag) {
        return;
    }

    const drag = state.drag;

    const dx =
        (event.clientX - drag.startX) /
        state.zoom;

    const dy =
        (event.clientY - drag.startY) /
        state.zoom;

    drag.block.x =
        Math.max(
            0,
            Math.round(
                drag.origX + dx
            )
        );

    drag.block.y =
        Math.max(
            0,
            Math.round(
                drag.origY + dy
            )
        );

    drag.element.style.left =
        drag.block.x + "px";

    drag.element.style.top =
        drag.block.y + "px";
}

function dragEnd() {

    if (!state.drag) {
        return;
    }

    const drag = state.drag;

    state.drag = null;

    document.removeEventListener(
        "mousemove",
        dragMove
    );

    debounceSave(
        drag.block.id,
        {
            x:drag.block.x,
            y:drag.block.y
        },
        0
    );
}

function startResize(event,element,block) {

    event.preventDefault();
    event.stopPropagation();

    state.resize = {
        element,
        block,
        startX:event.clientX,
        startY:event.clientY,
        origW:block.w,
        origH:block.h
    };

    document.addEventListener(
        "mousemove",
        resizeMove
    );

    document.addEventListener(
        "mouseup",
        resizeEnd,
        {once:true}
    );
}

function resizeMove(event) {

    if (!state.resize) {
        return;
    }

    const resize = state.resize;

    resize.block.w =
        Math.max(
            180,
            Math.round(
                resize.origW +
                (
                    event.clientX -
                    resize.startX
                ) /
                state.zoom
            )
        );

    resize.block.h =
        Math.max(
            120,
            Math.round(
                resize.origH +
                (
                    event.clientY -
                    resize.startY
                ) /
                state.zoom
            )
        );

    resize.element.style.width =
        resize.block.w + "px";

    resize.element.style.height =
        resize.block.h + "px";
}

function resizeEnd() {

    if (!state.resize) {
        return;
    }

    const resize = state.resize;

    state.resize = null;

    document.removeEventListener(
        "mousemove",
        resizeMove
    );

    debounceSave(
        resize.block.id,
        {
            w:resize.block.w,
            h:resize.block.h
        },
        0
    );
}

async function deleteBlock(id,element) {

    if (!confirm("Usunąć ten element?")) {
        return;
    }

    try {

        await api(
            "delete_block",
            {
                method:"POST",
                body:{id}
            }
        );

        element.remove();

        state.blocks.delete(id);

        status("Zapisano");

    } catch(error) {

        alert(error.message);
    }
}

async function duplicateBlock(block) {

    try {

        const created =
            await api(
                "create_block",
                {
                    method:"POST",
                    body:{
                        board_id:state.boardId,
                        type:block.type,
                        title:
                            (block.title || labelFor(block.type))
                            + " — kopia",
                        content:block.content
                    }
                }
            );

        await api(
            "update_block",
            {
                method:"POST",
                body:{
                    id:created.id,
                    x:block.x + 35,
                    y:block.y + 35,
                    w:block.w,
                    h:block.h
                }
            }
        );

        await selectBoard(
            state.boardId,
            true
        );

    } catch(error) {

        alert(error.message);
    }
}

async function editTitle(block,element) {

    const title =
        prompt(
            "Nazwa elementu:",
            block.title || ""
        );

    if (title === null) {
        return;
    }

    block.title =
        title.trim() ||
        labelFor(block.type);

    element.querySelector(
        ".block-title"
    ).textContent = block.title;

    debounceSave(
        block.id,
        {title:block.title},
        0
    );
}

function labelFor(type) {

    return {
        note:"Notatka",
        checklist:"Checklistę",
        sheet:"Arkusz",
        link:"Link",
        image:"Zdjęcie",
        file:"Plik"
    }[type] || "Element";
}

$("addBtn").onclick = () => {

    $("addMenu")
        .classList
        .toggle("open");
};

document
    .querySelectorAll("#addMenu button")
    .forEach(button => {

        button.onclick = () => {

            $("addMenu")
                .classList
                .remove("open");

            createBlock(
                button.dataset.type
            ).catch(error =>
                alert(error.message)
            );
        };
    });

$("boardSelect").onchange = event => {

    selectBoard(
        Number(event.target.value),
        false
    ).catch(error =>
        alert(error.message)
    );
};

$("newBoardBtn").onclick = () => {

    openModal(
        "Nowa tablica",
        [
            {
                name:"name",
                label:"Nazwa tablicy",
                type:"input",
                value:"Nowa tablica"
            }
        ],
        async values => {

            const result =
                await api(
                    "create_board",
                    {
                        method:"POST",
                        body:{
                            name:values.name
                        }
                    }
                );

            await loadBoards(result.id);
        }
    );
};

$("renameBoardBtn").onclick = () => {

    openModal(
        "Zmień nazwę tablicy",
        [
            {
                name:"name",
                label:"Nazwa",
                type:"input",
                value:$("boardTitle").textContent
            }
        ],
        async values => {

            await api(
                "rename_board",
                {
                    method:"POST",
                    body:{
                        id:state.boardId,
                        name:values.name
                    }
                }
            );

            await loadBoards(
                state.boardId
            );
        }
    );
};

$("deleteBoardBtn").onclick = async () => {

    const name =
        $("boardTitle").textContent;

    if (
        !confirm(
            `Usunąć tablicę "${name}" wraz z jej elementami?`
        )
    ) {
        return;
    }

    try {

        await api(
            "delete_board",
            {
                method:"POST",
                body:{
                    id:state.boardId
                }
            }
        );

        state.boardId = null;

        await loadBoards();

    } catch(error) {

        alert(error.message);
    }
};

$("modalClose").onclick = closeModal;
$("modalCancel").onclick = closeModal;

$("themeBtn").onclick = () => {

    document.body.classList.toggle("dark");

    localStorage.setItem(
        "notatnik-theme",
        document.body.classList.contains("dark")
            ? "dark"
            : "light"
    );
};

if (
    localStorage.getItem("notatnik-theme") ===
    "dark"
) {
    document.body.classList.add("dark");
}

function setZoom(value) {

    state.zoom =
        Math.min(
            1.5,
            Math.max(.5,value)
        );

    boardCanvas.style.transform =
        `scale(${state.zoom})`;

    $("zoomValue").textContent =
        Math.round(
            state.zoom * 100
        ) + "%";
}

$("zoomIn").onclick = () =>
    setZoom(state.zoom + .1);

$("zoomOut").onclick = () =>
    setZoom(state.zoom - .1);

$("resetZoom").onclick = () =>
    setZoom(1);

window.addEventListener(
    "keydown",
    event => {

        if (event.key === "Escape") {
            closeModal();
        }
    }
);

loadBoards().catch(error => {

    console.error(error);

    alert(
        "Nie można uruchomić notatnika: " +
        error.message
    );
});

})();