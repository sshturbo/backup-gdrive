# Backup to GDrive

Projeto para fazer backup de diretório Docker e enviar ao Google Drive.

## Requisitos

- Node.js (v14 ou superior)
- npm (v6 ou superior)
- PM2 (para gerenciamento de processos)

## Instalação

1. Clone o repositório:
    ```sh
    git clone https://fivey2023@bitbucket.org/codecodefi/backup-cloud.git
    cd backup-cloud
    ```

2. Instale as dependências:
    ```sh
    npm install
    ```

## Uso

### Iniciar a aplicação

Para iniciar a aplicação usando PM2, siga os passos abaixo:

1. Instale o PM2 globalmente (caso não tenha instalado):
    ```sh
    npm install pm2 -g
    ```

2. Inicie a aplicação com PM2:
    ```sh
     pm2 start npm --name backup -- start
    ```

3. Verifique se a aplicação está rodando:
    ```sh
    pm2 status
    ```

### Configurar as Credenciais

Depois de iniciar a aplicação, acesse o endereço onde a aplicação está rodando (por exemplo, `http://localhost:21467`).

1. Vá para a seção **Configurar Credenciais**.
2. Preencha os campos com as suas credenciais do Google Drive:
    - **Client ID**
    - **Client Secret**
    - **Redirect URI**
3. Salve as credenciais.

### Gerar Token

Depois de configurar as credenciais, vá para a seção **Gerar Token** e siga as instruções para autorizar o acesso ao Google Drive.

### Configurar o Backup

1. Vá para a seção de agendamento de backup.
2. Crie um agendamento utilizando uma expressão Cron.
3. Ative o backup.

### Parar a aplicação

Para parar a aplicação, use o comando abaixo:
```sh
pm2 stop backup
```

### Remover a aplicação

Para remover a aplicação do PM2, use o comando abaixo:
```sh
pm2 delete backup
```

# Avisos

Certifique-se de configurar corretamente suas credenciais do Google Drive no painel de configuração da aplicação.
Certifique-se de que o diretório de origem (SOURCE_DIR) e o nome do diretório de backup (BACKUP_DIR_NAME) estão corretos.


### Autor
Jefferson

### Licença
MIT License