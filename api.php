<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
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

function body(): array {
    $raw = file_get_contents('php://input');

    if (!$raw) {
        return [];
    }

    $data = json_decode($raw, true);

    return is_array($data) ? $data : [];
}

function out(array $data, int $status = 200): never {
    http_response_code($status);

    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );

    exit;
}

function intv(mixed $value, int $default = 0): int {
    if ($value === null || $value === '') {
        return $default;
    }

    return (int)$value;
}

function cleanText(mixed $value, int $max = 10000): string {
    $value = trim((string)$value);

    if (mb_strlen($value) > $max) {
        $value = mb_substr($value, 0, $max);
    }

    return $value;
}

$action = $_GET['action'] ?? '';

try {

    switch ($action) {

        case 'boards':

            $rows = $db->query("
                SELECT id,name,created_at,updated_at
                FROM boards
                ORDER BY updated_at DESC,id DESC
            ")->fetchAll(PDO::FETCH_ASSOC);

            out([
                'ok' => true,
                'boards' => $rows
            ]);

        case 'board':

            $id = intv($_GET['id'] ?? 0);

            $stmt = $db->prepare("
                SELECT id,name,created_at,updated_at
                FROM boards
                WHERE id=?
            ");

            $stmt->execute([$id]);

            $board = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$board) {
                out([
                    'ok'=>false,
                    'error'=>'Nie znaleziono tablicy'
                ],404);
            }

            $stmt = $db->prepare("
                SELECT id,type,title,content,x,y,w,h,z_index,created_at,updated_at
                FROM blocks
                WHERE board_id=?
                ORDER BY z_index,id
            ");

            $stmt->execute([$id]);

            out([
                'ok'=>true,
                'board'=>$board,
                'blocks'=>$stmt->fetchAll(PDO::FETCH_ASSOC)
            ]);

        case 'create_board':

            $data = body();

            $name = cleanText(
                $data['name'] ?? 'Nowa tablica',
                120
            );

            if ($name === '') {
                $name = 'Nowa tablica';
            }

            $stmt = $db->prepare("
                INSERT INTO boards(name)
                VALUES(?)
            ");

            $stmt->execute([$name]);

            out([
                'ok'=>true,
                'id'=>(int)$db->lastInsertId()
            ]);

        case 'rename_board':

            $data = body();

            $id = intv($data['id'] ?? 0);
            $name = cleanText($data['name'] ?? '',120);

            if (!$id || $name === '') {
                out([
                    'ok'=>false,
                    'error'=>'Nieprawidłowe dane'
                ],400);
            }

            $stmt = $db->prepare("
                UPDATE boards
                SET name=?,updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            ");

            $stmt->execute([$name,$id]);

            out(['ok'=>true]);

        case 'delete_board':

            $data = body();

            $id = intv($data['id'] ?? 0);

            if (!$id) {
                out([
                    'ok'=>false,
                    'error'=>'Brak ID tablicy'
                ],400);
            }

            $count = (int)$db->query("
                SELECT COUNT(*) FROM boards
            ")->fetchColumn();

            if ($count <= 1) {
                out([
                    'ok'=>false,
                    'error'=>'Nie można usunąć ostatniej tablicy.'
                ],400);
            }

            $stmt = $db->prepare("
                SELECT id
                FROM boards
                WHERE id=?
            ");

            $stmt->execute([$id]);

            if (!$stmt->fetchColumn()) {
                out([
                    'ok'=>false,
                    'error'=>'Tablica nie istnieje.'
                ],404);
            }

            $stmt = $db->prepare("
                SELECT stored_name
                FROM attachments
                WHERE block_id IN (
                    SELECT id FROM blocks WHERE board_id=?
                )
            ");

            $stmt->execute([$id]);

            $files = $stmt->fetchAll(PDO::FETCH_COLUMN);

            $stmt = $db->prepare("
                DELETE FROM boards
                WHERE id=?
            ");

            $stmt->execute([$id]);

            foreach ($files as $file) {
                $path = __DIR__ . '/uploads/' . basename((string)$file);

                if (is_file($path)) {
                    @unlink($path);
                }
            }

            out(['ok'=>true]);

        case 'create_block':

            $data = body();

            $boardId = intv($data['board_id'] ?? 0);
            $type = (string)($data['type'] ?? 'note');

            $allowed = [
                'note',
                'checklist',
                'sheet',
                'link',
                'image',
                'file'
            ];

            if (
                !$boardId ||
                !in_array($type,$allowed,true)
            ) {
                out([
                    'ok'=>false,
                    'error'=>'Nieprawidłowy typ elementu.'
                ],400);
            }

            $stmt = $db->prepare("
                SELECT id FROM boards WHERE id=?
            ");

            $stmt->execute([$boardId]);

            if (!$stmt->fetchColumn()) {
                out([
                    'ok'=>false,
                    'error'=>'Tablica nie istnieje.'
                ],404);
            }

            $defaults = [
                'note'=>[360,240],
                'checklist'=>[340,270],
                'sheet'=>[520,330],
                'link'=>[340,200],
                'image'=>[380,300],
                'file'=>[340,210]
            ];

            [$w,$h] = $defaults[$type];

            $stmt = $db->prepare("
                SELECT COALESCE(MAX(z_index),0)+1
                FROM blocks
                WHERE board_id=?
            ");

            $stmt->execute([$boardId]);

            $z = (int)$stmt->fetchColumn();

            $stmt = $db->prepare("
                SELECT COUNT(*)
                FROM blocks
                WHERE board_id=?
            ");

            $stmt->execute([$boardId]);

            $index = (int)$stmt->fetchColumn();

            // Automatyczne rozmieszczanie kolejnych kart.
            $x = 50 + (($index % 4) * 390);
            $y = 50 + ((int)floor($index / 4) * 300);

            $title = cleanText(
                $data['title'] ?? '',
                200
            );

            $content = (string)($data['content'] ?? '');

            $stmt = $db->prepare("
                INSERT INTO blocks
                (board_id,type,title,content,x,y,w,h,z_index)
                VALUES(?,?,?,?,?,?,?,?,?)
            ");

            $stmt->execute([
                $boardId,
                $type,
                $title,
                $content,
                $x,
                $y,
                $w,
                $h,
                $z
            ]);

            $id = (int)$db->lastInsertId();

            $stmt = $db->prepare("
                UPDATE boards
                SET updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            ");

            $stmt->execute([$boardId]);

            out([
                'ok'=>true,
                'id'=>$id
            ]);

        case 'update_block':

            $data = body();

            $id = intv($data['id'] ?? 0);

            if (!$id) {
                out([
                    'ok'=>false,
                    'error'=>'Brak ID elementu.'
                ],400);
            }

            $fields = [];
            $values = [];

            if (array_key_exists('title',$data)) {
                $fields[] = 'title=?';
                $values[] = cleanText($data['title'],200);
            }

            if (array_key_exists('content',$data)) {
                $fields[] = 'content=?';
                $values[] = (string)$data['content'];
            }

            foreach (['x','y','w','h','z_index'] as $field) {
                if (array_key_exists($field,$data)) {
                    $fields[] = "$field=?";
                    $values[] = intv($data[$field]);
                }
            }

            if (!$fields) {
                out(['ok'=>true]);
            }

            $fields[] = 'updated_at=CURRENT_TIMESTAMP';

            $values[] = $id;

            $stmt = $db->prepare("
                UPDATE blocks
                SET ".implode(',',$fields)."
                WHERE id=?
            ");

            $stmt->execute($values);

            $stmt = $db->prepare("
                SELECT board_id
                FROM blocks
                WHERE id=?
            ");

            $stmt->execute([$id]);

            $boardId = (int)$stmt->fetchColumn();

            if ($boardId) {
                $stmt = $db->prepare("
                    UPDATE boards
                    SET updated_at=CURRENT_TIMESTAMP
                    WHERE id=?
                ");

                $stmt->execute([$boardId]);
            }

            out(['ok'=>true]);

        case 'delete_block':

            $data = body();

            $id = intv($data['id'] ?? 0);

            if (!$id) {
                out([
                    'ok'=>false,
                    'error'=>'Brak ID.'
                ],400);
            }

            $stmt = $db->prepare("
                SELECT board_id
                FROM blocks
                WHERE id=?
            ");

            $stmt->execute([$id]);

            $boardId = (int)$stmt->fetchColumn();

            if (!$boardId) {
                out([
                    'ok'=>false,
                    'error'=>'Element nie istnieje.'
                ],404);
            }

            $stmt = $db->prepare("
                SELECT stored_name
                FROM attachments
                WHERE block_id=?
            ");

            $stmt->execute([$id]);

            $files = $stmt->fetchAll(PDO::FETCH_COLUMN);

            $stmt = $db->prepare("
                DELETE FROM blocks
                WHERE id=?
            ");

            $stmt->execute([$id]);

            foreach ($files as $file) {
                $path = __DIR__ . '/uploads/' . basename((string)$file);

                if (is_file($path)) {
                    @unlink($path);
                }
            }

            $stmt = $db->prepare("
                UPDATE boards
                SET updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            ");

            $stmt->execute([$boardId]);

            out(['ok'=>true]);

        case 'upload':

            $blockId = intv($_POST['block_id'] ?? 0);

            if (!$blockId || empty($_FILES['file'])) {
                out([
                    'ok'=>false,
                    'error'=>'Brak pliku.'
                ],400);
            }

            $file = $_FILES['file'];

            if ($file['error'] !== UPLOAD_ERR_OK) {
                out([
                    'ok'=>false,
                    'error'=>'Błąd przesyłania pliku.'
                ],400);
            }

            if ($file['size'] > 15 * 1024 * 1024) {
                out([
                    'ok'=>false,
                    'error'=>'Maksymalny rozmiar pliku to 15 MB.'
                ],400);
            }

            $stmt = $db->prepare("
                SELECT id,type
                FROM blocks
                WHERE id=?
            ");

            $stmt->execute([$blockId]);

            $block = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$block) {
                out([
                    'ok'=>false,
                    'error'=>'Element nie istnieje.'
                ],404);
            }

            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mime = $finfo->file($file['tmp_name'])
                ?: 'application/octet-stream';

            $allowed = [
                'image/jpeg'=>'jpg',
                'image/png'=>'png',
                'image/gif'=>'gif',
                'image/webp'=>'webp',
                'application/pdf'=>'pdf',
                'text/plain'=>'txt',
                'text/csv'=>'csv',
                'application/zip'=>'zip',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'=>'docx',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'=>'xlsx'
            ];

            if (!isset($allowed[$mime])) {
                out([
                    'ok'=>false,
                    'error'=>'Ten typ pliku nie jest dozwolony w tej wersji.'
                ],400);
            }

            if (
                $block['type'] === 'image' &&
                !str_starts_with($mime,'image/')
            ) {
                out([
                    'ok'=>false,
                    'error'=>'Element zdjęcia wymaga pliku graficznego.'
                ],400);
            }

            $uploadDir = __DIR__ . '/uploads';

            if (!is_dir($uploadDir)) {
                mkdir($uploadDir,0775,true);
            }

            $stored = bin2hex(random_bytes(16))
                . '.'
                . $allowed[$mime];

            $target = $uploadDir . '/' . $stored;

            if (!move_uploaded_file(
                $file['tmp_name'],
                $target
            )) {
                out([
                    'ok'=>false,
                    'error'=>'Nie można zapisać pliku.'
                ],500);
            }

            $originalName = basename((string)$file['name']);

            $stmt = $db->prepare("
                INSERT INTO attachments
                (block_id,original_name,stored_name,mime_type,size)
                VALUES(?,?,?,?,?)
            ");

            $stmt->execute([
                $blockId,
                $originalName,
                $stored,
                $mime,
                (int)$file['size']
            ]);

            $url = 'uploads/' . $stored;

            $stmt = $db->prepare("
                UPDATE blocks
                SET content=?,title=?,updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            ");

            $stmt->execute([
                $url,
                cleanText(
                    $_POST['title'] ?? $originalName,
                    200
                ),
                $blockId
            ]);

            out([
                'ok'=>true,
                'url'=>$url,
                'name'=>$originalName,
                'mime'=>$mime
            ]);

        default:

            out([
                'ok'=>false,
                'error'=>'Nieznana akcja.'
            ],404);
    }

} catch (Throwable $e) {

    out([
        'ok'=>false,
        'error'=>$e->getMessage()
    ],500);
}