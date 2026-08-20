<?php
declare(strict_types=1);
session_start();

$dbDir = __DIR__ . '/data';
if (!is_dir($dbDir)) {
    mkdir($dbDir, 0775, true);
}

$db = new PDO('sqlite:' . $dbDir . '/notatnik.sqlite');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec("PRAGMA foreign_keys = ON");

$db->exec("
CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT DEFAULT '',
    content TEXT DEFAULT '',
    x INTEGER NOT NULL DEFAULT 40,
    y INTEGER NOT NULL DEFAULT 40,
    w INTEGER NOT NULL DEFAULT 320,
    h INTEGER NOT NULL DEFAULT 220,
    z_index INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(block_id) REFERENCES blocks(id) ON DELETE CASCADE
);
");

$count = (int)$db->query("SELECT COUNT(*) FROM boards")->fetchColumn();

if ($count === 0) {
    $stmt = $db->prepare("INSERT INTO boards (name) VALUES (?)");
    $stmt->execute(['Moja pierwsza tablica']);
    $boardId = (int)$db->lastInsertId();

    $stmt = $db->prepare("
        INSERT INTO blocks
        (board_id,type,title,content,x,y,w,h,z_index)
        VALUES (?,?,?,?,?,?,?,?,?)
    ");

    $stmt->execute([
        $boardId,
        'note',
        'Witaj!',
        '<p>To jest Twoja pierwsza tablica.</p><p>Kliknij <b>＋ Dodaj</b>, aby utworzyć notatkę, checklistę, arkusz, zdjęcie, plik lub link.</p>',
        50, 50, 380, 230, 1
    ]);

    $stmt->execute([
        $boardId,
        'checklist',
        'Lista startowa',
        json_encode([
            ['text'=>'Uruchomić aplikację','done'=>false],
            ['text'=>'Dodać własną notatkę','done'=>false],
            ['text'=>'Przeciągnąć element','done'=>false],
            ['text'=>'Dodać zdjęcie','done'=>false]
        ], JSON_UNESCAPED_UNICODE),
        470, 70, 340, 260, 2
    ]);
}
?>
<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notatnik WWW</title>
<link rel="stylesheet" href="assets/notatnik.css?v=1.1.0">
</head>
<body>
<div class="app">

<header class="topbar">
    <div class="brand">
        <div class="brand-icon">✦</div>
        <div>
            <strong>Notatnik</strong>
            <span>Twoja prywatna tablica</span>
        </div>
    </div>

    <div class="board-picker">
        <select id="boardSelect" aria-label="Wybierz tablicę"></select>
        <button id="renameBoardBtn" class="icon-btn" title="Zmień nazwę tablicy">✎</button>
        <button id="deleteBoardBtn" class="icon-btn danger-btn" title="Usuń tablicę">🗑</button>
        <button id="newBoardBtn" class="secondary-btn">＋ Tablica</button>
    </div>

    <div class="top-actions">
        <span id="saveStatus" class="save-status">● Gotowe</span>
        <button id="themeBtn" class="icon-btn" title="Tryb jasny/ciemny">☾</button>
    </div>
</header>

<main class="workspace">

<aside class="sidebar">
    <button id="addBtn" class="add-main">＋ Dodaj</button>

    <div id="addMenu" class="add-menu">
        <button data-type="note">📝 <span>Notatka</span></button>
        <button data-type="checklist">☑️ <span>Checklistę</span></button>
        <button data-type="sheet">📊 <span>Arkusz</span></button>
        <button data-type="link">🔗 <span>Link</span></button>
        <button data-type="image">📷 <span>Zdjęcie</span></button>
        <button data-type="file">📎 <span>Plik</span></button>
    </div>

    <div class="sidebar-section">
        <div class="sidebar-title">Tablice</div>
        <div id="boardList"></div>
    </div>

    <div class="sidebar-help">
        <b>Jak używać?</b>
        <p>Przeciągaj karty po tablicy.</p>
        <p>Zmieniaj ich rozmiar uchwytem w prawym dolnym rogu.</p>
        <p>Treść i pozycje zapisują się automatycznie.</p>
    </div>
</aside>

<section class="board-area">

<div class="board-toolbar">
    <div>
        <h1 id="boardTitle">Tablica</h1>
        <span id="boardMeta"></span>
    </div>

    <div class="toolbar-actions">
        <button id="zoomOut" class="icon-btn">−</button>
        <span id="zoomValue">100%</span>
        <button id="zoomIn" class="icon-btn">＋</button>
        <button id="resetZoom" class="icon-btn" title="Reset zoom">⟳</button>
    </div>
</div>

<div id="boardViewport" class="board-viewport">
    <div id="boardCanvas" class="board-canvas"></div>
</div>

</section>
</main>
</div>

<div id="modal" class="modal hidden">
    <div class="modal-card">
        <div class="modal-head">
            <strong id="modalTitle">Dodaj</strong>
            <button id="modalClose" class="icon-btn">×</button>
        </div>

        <form id="modalForm">
            <div id="modalFields"></div>

            <div class="modal-actions">
                <button type="button" id="modalCancel" class="secondary-btn">Anuluj</button>
                <button class="primary-btn" type="submit">Zapisz</button>
            </div>
        </form>
    </div>
</div>

<input id="fileInput" type="file" hidden>

<script src="assets/notatnik.js?v=1.1.0"></script>
</body>
</html>