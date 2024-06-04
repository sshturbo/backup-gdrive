const fs = require('fs');
const path = require('path');
const tar = require('tar');
const { google } = require('googleapis');
const moment = require('moment-timezone');
const { WebClient } = require('@slack/web-api');

const SOURCE_DIR = process.env.SOURCE_DIR;
const BACKUP_DIR_NAME = process.env.BACKUP_DIR_NAME;
const TIMEZONE = process.env.TIMEZONE;
const MAX_BACKUPS = process.env.MAX_BACKUPS || 7;
const slackToken = process.env.SLACK_TOKEN;
const slackChannel = process.env.SLACK_CHANNEL;
const slackClient = new WebClient(slackToken);

if (!SOURCE_DIR || !BACKUP_DIR_NAME || !TIMEZONE) {
    throw new Error('SOURCE_DIR, BACKUP_DIR_NAME, e TIMEZONE precisam estar definidos nas variáveis de ambiente.');
}

const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

/**
 * Envia uma notificação ao Slack.
 *
 * @param {string} message
 */
async function notifySlack(message) {
    if (slackToken && slackChannel) {
        await slackClient.chat.postMessage({
            channel: slackChannel,
            text: message
        });
    }
}

/**
 * Limpa backups antigos, mantendo apenas os últimos MAX_BACKUPS.
 *
 * @param {string} backupDir
 */
async function cleanOldBackups(backupDir) {
    const files = fs.readdirSync(backupDir)
        .map(file => ({ name: file, time: fs.statSync(path.join(backupDir, file)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time)
        .map(file => file.name);

    while (files.length > MAX_BACKUPS) {
        const fileToDelete = files.pop();
        fs.unlinkSync(path.join(backupDir, fileToDelete));
        log(`Excluindo backup antigo: ${fileToDelete}`);
    }
}

/**
 * Cria um backup do diretório SOURCE_DIR em formato tar.gz e salva em um diretório de backup.
 *
 * @returns {Promise<{ outputPath: string, date: string, time: string }>}
 */
async function createBackup() {
    const now = moment().tz(TIMEZONE);
    const date = now.format('YYYY-MM-DD');
    const time = now.format('HH-mm-ss');
    const parentDir = path.dirname(SOURCE_DIR); // Diretório pai de SOURCE_DIR
    const backupDir = path.join(parentDir, BACKUP_DIR_NAME, date);
    const outputPath = path.join(backupDir, `backup-${time}.tar.gz`);

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    log(`Iniciando backup de ${SOURCE_DIR} para ${outputPath}`);
    await cleanOldBackups(path.join(parentDir, BACKUP_DIR_NAME));

    return new Promise((resolve, reject) => {
        tar.c(
            {
                gzip: true,
                file: outputPath,
                cwd: parentDir
            },
            [path.basename(SOURCE_DIR)]
        ).then(() => {
            resolve({ outputPath, date, time });
        }).catch((err) => {
            log(`Erro ao criar o arquivo tar.gz: ${err.message}`);
            reject(err);
        });
    });
}

/**
 * Faz o upload do arquivo de backup para o Google Drive.
 *
 * @param {object} auth
 * @param {string} filePath
 * @param {string} date
 * @param {number} retryCount
 * @returns {Promise<object>}
 */
async function uploadBackup(auth, filePath, date, retryCount = 3) {
    try {
        const drive = google.drive({ version: 'v3', auth });
        const backupCloudFolderId = await getOrCreateFolder(drive, BACKUP_DIR_NAME);
        const dateFolderId = await getOrCreateFolder(drive, date, backupCloudFolderId);

        const fileMetadata = {
            name: path.basename(filePath),
            parents: [dateFolderId]
        };
        const media = {
            mimeType: 'application/gzip',
            body: fs.createReadStream(filePath)
        };

        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
        });

        // Excluir o arquivo local após o upload
        fs.unlinkSync(filePath);
        return response;
    } catch (error) {
        if (retryCount > 0) {
            log(`Erro no upload, tentativas restantes: ${retryCount}, erro: ${error.message}`);
            return uploadBackup(auth, filePath, date, retryCount - 1);
        } else {
            throw new Error(`Falha no upload após múltiplas tentativas: ${error.message}`);
        }
    }
}

/**
 * Obtém ou cria uma pasta no Google Drive.
 *
 * @param {object} drive
 * @param {string} folderName
 * @param {string} parentFolderId
 * @returns {Promise<string>}
 */
async function getOrCreateFolder(drive, folderName, parentFolderId = null) {
    const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder'${parentFolderId ? ` and '${parentFolderId}' in parents` : ''}`;
    const response = await drive.files.list({
        q: query,
        fields: 'files(id, name)'
    });

    const folder = response.data.files.find(file => file.name === folderName);

    if (folder) {
        return folder.id;
    } else {
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: parentFolderId ? [parentFolderId] : []
        };
        const folder = await drive.files.create({
            resource: fileMetadata,
            fields: 'id'
        });
        return folder.data.id;
    }
}

(async () => {
    try {
        const auth = await authenticate(); // Assumindo que você tem uma função de autenticação
        const { outputPath, date, time } = await createBackup();
        await uploadBackup(auth, outputPath, date);
        log('Backup e upload concluídos com sucesso.');
        await notifySlack(`Backup criado e carregado com sucesso: ${outputPath}`);
    } catch (error) {
        log(`Erro durante o processo de backup: ${error.message}`);
        await notifySlack(`Erro durante o processo de backup: ${error.message}`);
    }
})();

module.exports = { createBackup, uploadBackup };