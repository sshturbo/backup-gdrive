const fs = require('fs');
const { google } = require('googleapis');
const path = require('path');

// Defina o caminho para a pasta onde os arquivos serão salvos
const dataDir = path.join(__dirname, 'data');

// Garantir que a pasta exista
function ensureDataDirectoryExists() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
        log(`Diretório ${dataDir} criado.`);
    } else {
        log(`Diretório ${dataDir} já existe.`);
    }
}

// Atualize o caminho do TOKEN_PATH para a pasta data
const TOKEN_PATH = path.join(dataDir, 'token.json');

const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

async function authenticate() {
    const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env;

    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
        throw new Error('CLIENT_ID, CLIENT_SECRET, e REDIRECT_URI precisam estar definidos nas variáveis de ambiente.');
    }

    const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

    ensureDataDirectoryExists();

    if (fs.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        oAuth2Client.setCredentials(token);

        try {
            // Verificar se o token de acesso é válido fazendo uma chamada de teste à API
            const accessToken = await oAuth2Client.getAccessToken();
            if (accessToken && accessToken.token) {
                log('Token de acesso válido.');
            } else {
                throw new Error('Token de acesso não é válido.');
            }
        } catch (err) {
            // Se o token for inválido ou expirado, regenerar usando o refresh token
            if (err.response && err.response.data.error === 'invalid_grant') {
                const authUrl = oAuth2Client.generateAuthUrl({
                    access_type: 'offline',
                    scope: ['https://www.googleapis.com/auth/drive.file']
                });
                throw new Error(`Token expirado ou inválido. Por favor, autorize este aplicativo visitando esta URL: ${authUrl}`);
            } else {
                throw new Error(`Erro ao verificar o token de acesso: ${err.message}`);
            }
        }
    } else {
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/drive.file']
        });
        throw new Error(`Token não encontrado. Por favor, autorize este aplicativo visitando esta URL: ${authUrl}`);
    }

    // Salvar o token atualizado no arquivo
    oAuth2Client.on('tokens', (tokens) => {
        if (tokens) {
            const currentToken = fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) : {};
            let updated = false;

            if (tokens.refresh_token) {
                currentToken.refresh_token = tokens.refresh_token;
                updated = true;
            }
            if (tokens.access_token) {
                currentToken.access_token = tokens.access_token;
                updated = true;
            }
            currentToken.scope = tokens.scope;
            currentToken.token_type = tokens.token_type;
            currentToken.expiry_date = tokens.expiry_date;

            if (updated) {
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(currentToken, null, 2));
                log('Token atualizado salvo com sucesso.');
            }
        }
    });

    return oAuth2Client;
}

module.exports = authenticate;
