const Discord = require('discord.js')
const Axios = require('axios')
const { table } = require('table')
const client = new Discord.Client()
const config = require('./config/config.json')
const fs = require('fs')
const sqlite3 = require('sqlite3').verbose();

if (!fs.existsSync('./database')) {
    fs.mkdirSync('./database');
}
const db = new sqlite3.Database('./database/database.db');
db.run("CREATE TABLE IF NOT EXISTS channels (channelId TEXT PRIMARY KEY, type TEXT)");

const axios = Axios.create({
    baseURL: `${config.api_url}/bot`,
    headers: {
        Authorization: `Bearer ${config.api_bearer_token}`
    }
})

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`)
})

const prefix = config.prefix + ' '
let strings = Object.entries(require(fs.existsSync('./config/strings.json') ? './config/strings.json' : './config/strings.example.json')).reduce((acc, entry) => {
    acc[entry[0]] = entry[1].replace(/%prefix%/g, config.prefix)
    return acc
}, {})

client.on('message', async (msg) => {
    if(msg.author.bot || msg.channel.type !== 'text') return
    if(!msg.content.startsWith(prefix)) return

    let dbChannel
    try {
        dbChannel = await getChannelDbInfo({channelId: msg.channel.id})
    } catch(e) {
        console.error(e);
        return msg.channel.send('Could not process your message.')
    }

    let commands = msg.content
      .substring(prefix.length)
      .trim()
      .replace(/\s\s+/g, ' ')
      .split(' ')
    parseCommands({ commands, msg, dbChannel })
});

function parseCommands({ commands = [], msg, dbChannel }) {
    if(commands.length === 0) {
        return
    }

    switch(commands[0]) {
        case 'start':
            handlePublicCommand(handleServerStart, { msg, commands, dbChannel})
            break
        case 'stop':
            handlePublicCommand(handleServerStop, { msg, commands, dbChannel})
            break
        case 'available':
            handlePublicCommand(handleAvailable, { msg, commands, dbChannel})
            break
        case 'help':
            handlePublicCommand(handleHelp, { msg, commands, dbChannel})
            break
        case 'servers':
            handleAdminCommand(handleServers, { msg, commands, dbChannel})
            break
        case 'add':
            handleAdminCommand(handleAdd, { msg, commands, dbChannel})
            break
        case 'delete':
            handleAdminCommand(handleDelete, { msg, commands, dbChannel})
            break
        case 'rcon':
            handleAdminCommand(handleRcon, { msg, commands, dbChannel})
            break
        case 'channel':
            handleChannelCommand({ msg, commands })
            break
        default:
            handleWrongCommand({ msg })
    }
}

function handlePublicCommand(fn, { msg, commands, dbChannel }) {
    if(!dbChannel || (dbChannel.type !== 'PUBLIC' && dbChannel.type !== 'ADMIN')) {
        return msg.channel.send(strings.WRONG_CHANNEL)
    }

    fn({ msg, commands, dbChannel })
}

function handleAdminCommand(fn, { msg, commands, dbChannel }) {
    if(!dbChannel) {
        return msg.channel.send(strings.WRONG_CHANNEL)
    }
    if(dbChannel.type !== 'ADMIN') {
        return msg.channel.send(strings.CHANNEL_NOT_ADMIN)
    }

    fn({ msg, commands })
}

function handleChannelCommand({ msg, commands = []}) {
    if(!fromAdmin({ msg })) {
        return
    }

    switch(commands[1]) {
        case 'public':
            setChannelDbInfo({ channelId: msg.channel.id, type: 'PUBLIC' })
              .then(() => {
                  msg.channel.send('Channel set to public.')
              })
              .catch(() => {
                  msg.channel.send('Unable to set channel to public.')
              })
            break
        case 'admin':
            setChannelDbInfo({ channelId: msg.channel.id, type: 'ADMIN' })
              .then(() => {
                  msg.channel.send('Channel set to admin.')
              })
              .catch(() => {
                  msg.channel.send('Unable to set channel to admin.')
              })
            break
        case 'remove':
            removeChannelDbInfo({ channelId: msg.channel.id })
              .then(() => {
                  msg.channel.send('Channel removed.')
              })
              .catch(() => {
                  msg.channel.send('Unable to remove channel.')
              })
            break
        case 'list':
            getChannelsDbInfo({ msg })
              .then((rows) => {
                  msg.channel.send(JSON.stringify(rows))
              })
            break
        default:
            return handleWrongCommand({ msg, command: commands[0] })
    }
}

function handleHelp({ msg, dbChannel }) {
    let helpString = `**Available commands:**
${prefix} available
`
    if(config.allow_random_region) {
        helpString += `${prefix} start\n`
    }
helpString += `${prefix} start <region>
${prefix} stop`

    if(fromAdmin({ msg }) || (dbChannel && dbChannel.type === 'ADMIN')) {
        helpString += `

**Admin commands**:
${prefix} servers
${prefix} add <ip> <port> <rconpassword> <optional region>
${prefix} delete <id>
${prefix} rcon <id> <command>
${prefix} channel <public|admin|remove>
`
    }

    msg.channel.send(helpString)
}

function handleAvailable({ msg }) {
    axios
      .get(`/server/${msg.guild.id}/pool`)
      .then((res) => {
          let regions = {}
          for(let server of res.data) {
              if(!server.region) server.region = 'WORLD'
              if(!regions[server.region]) {
                  regions[server.region] = {
                      AVAILABLE: 0,
                      COUNT: 0
                  }
              }
              if(server.UrTServerStatus && server.UrTServerStatus.status === 'AVAILABLE') {
                  regions[server.region].AVAILABLE += 1
              }
              regions[server.region].COUNT += 1
          }
          let data = [['Region', 'Available servers']]
          for(let region of Object.keys(regions)) {
              data.push([region, `${regions[region].AVAILABLE}/${regions[region].COUNT}`])
          }
          msg.channel.send('```' + table(data) + '```')
      })
      .catch(e => {
          console.error(e)
          msg.channel.send(strings.API_ERROR)
      })
}

function handleServers({ msg }) {
    axios
        .get(`/server/${msg.guild.id}/pool`)
        .then((res) => {
            let data = [['ID', 'Address', 'RCON', 'Region', 'Status']]
            let inUse = []
            res.data.forEach(s => {
                data.push([s.id, `${s.ip}:${s.port}`, s.rconpassword, s.region, s.UrTServerStatus.status])
                if(s.UrTServerStatus.status === 'IN_USE') {
                    inUse.push([`[${s.id}] /connect ${s.ip};password ${s.UrTServerStatus.password};rconpassword ${s.rconpassword}`])
                }
            })
            msg.channel.send('```' + table(data) + '\n\n' + inUse.join('\n') + '```')
        })
        .catch(e => {
            console.error(e)
            msg.channel.send(strings.API_ERROR)
        })
}

function handleAdd({ msg, commands = [] }) {
    if(commands.length !== 4 && commands.length !== 5) {
        return handleWrongCommand({msg, command: commands[0]})
    }

    let ip = commands[1]
    let port = commands[2]
    let rconpassword = commands[3]
    let region = commands[4]

    axios
      .post(`/server/${msg.guild.id}/pool`, {
          ip, port, rconpassword, region
      })
      .then((res) => {
          msg.channel.send(strings.SERVER_ADDED_SUCCESS)
      })
      .catch(e => {
          console.error(e.response)
          msg.channel.send(strings.API_ERROR)
      })
}

function handleDelete({ msg, commands = [] }) {
    if(commands.length !== 2) {
        return handleWrongCommand({msg, command: commands[0]})
    }

    let id = commands[1]

    axios
      .delete(`/server/${msg.guild.id}/pool/${id}`)
      .then((res) => {
          msg.channel.send(strings.SERVER_REMOVED_SUCCESS)
      })
      .catch(e => {
          if(e.response && e.response.status && e.response.status === 404) {
              msg.channel.send(strings.SERVER_NOT_FOUND)
          } else {
              msg.channel.send(strings.API_ERROR)
          }
      })
}

function handleRcon({ msg, commands = [] }) {
    if(commands.length < 3) {
        return handleWrongCommand({msg, command: commands[0]})
    }
    let re = new RegExp(prefix + '[\\s]*rcon[\\s]+(?:.*?)[\\s]+(.*)', 'g')
    let exec = re.exec(msg.content)
    if(!exec || !exec[1]) {
        return handleWrongCommand({msg, command: 'rcon'})
    }

    let id = commands[1]
    let command = exec[1]

    axios
      .post(`/server/${msg.guild.id}/pool/${id}/rcon`, {
          command
      })
      .then((res) => {
          msg.channel.send('```\n' + res.data.data.substring(0, 1900) + '\n```')
      })
      .catch((e) => {
          console.log(e)
          if(e.response && e.response.status && e.response.status === 404) {
              msg.channel.send(strings.SERVER_NOT_FOUND)
          } else {
              msg.channel.send(strings.API_ERROR)
          }
      })
}

function handleServerStart({ msg, commands = [] }) {
    if(commands.length !== 2 || (commands.length === 1 && !config.allow_random_region)) {
        return handleWrongCommand({ msg, command: commands[0]})
    }
    let region = commands.length === 2 ? commands[1] : undefined
    requestServer({ serverId: msg.guild.id, userId: msg.author.id, region })
        .then(() => {
            msg.channel.send(strings.SERVER_STARTED)
        })
        .catch((err) => {
            msg.channel.send(err)
        })
}

async function requestServer({ serverId, userId, region }) {
    try {
        return (await axios.post(`/server/${serverId}/request`, {
            userDiscordId: userId,
            region
        })).data
    } catch(e) {
        if(e.response && e.response.data) {
            switch(e.response.data.error) {
                case 'NO_SERVER_AVAILABLE':
                    throw strings.NO_SERVER_AVAILABLE
                case 'ALREADY_REQUESTED_SERVER':
                    throw strings.USER_SERVERLIMIT_REACHED
            }
        }
        throw strings.SERVER_REQUEST_ERROR
    }
}

function handleServerStop({ msg, commands = [] }) {
    if(commands.length !== 1) {
        return handleWrongCommand({ msg, commands: commands[0] })
    }
    stopServer({ serverId: msg.guild.id, userId: msg.author.id })
        .then(() => {
            msg.channel.send(strings.SERVER_STOPPED)
        })
        .catch((err) => {
            msg.channel.send(err)
        })
}

async function stopServer({ serverId, userId }) {
    try {
        return (await axios.post(`/server/${serverId}/stop`, {
            userDiscordId: userId
        })).data
    } catch(e) {
        if(e.response && e.response.status) {
            switch (e.response.status) {
                case 404:
                    throw strings.SERVER_STOP_NOT_FOUND
            }
        }
        throw strings.SERVER_STOP_ERROR
    }
}

setInterval(collectServers, 5000)

async function collectServers() {
    try {
        const servers = (await axios
            .get('/collect')).data

        for(let server of servers) {
            if(!server.UrTServerStatus) continue
            const address = `${server.ip}:${server.port}`
            const { userDiscordId, password, refpass } = server.UrTServerStatus

            if(!address || !userDiscordId) continue

            try {
                const user = await client.users.fetch(userDiscordId)
                await user.send(
`Your server is ready :muscle:

**connect ${address};password ${password}**

/reflogin ${refpass}

**Administration**
/ref kick <player>
/ref reload
/ref restart
/ref map <map>

**Configs**
/ref exec uz5v5ctf
(uz5v5bm, uz5v5cah, uz5v5ft, uz5v5ftl, uz5v5nowave, uz5v5ts, ncbomb, ncctf, ncts, knockout, skeetshoot, utcs_fall21_ts, utcs_fall21_ctf)

Try */ref help* for more commands.

Your server will be available for the next two hours.`)
            } catch(e) {
                console.error(e)
            }
        }
    } catch(e) {
        console.error(e)
    }
}

function handleWrongCommand({ msg, command }) {
    msg.channel.send(strings.WRONG_COMMAND)
}

function fromAdmin({ msg }) {
    return msg.member.hasPermission('ADMINISTRATOR') || (config.custom_admin_ids.indexOf(msg.author.id) !== -1)
}

function setChannelDbInfo({ channelId, type }) {
    return new Promise((resolve, reject) => {
        if(!type || ['PUBLIC', 'ADMIN'].indexOf(type) === -1) {
            type = 'PUBLIC'
        }
        db.run(`INSERT OR REPLACE INTO channels(channelId, type) VALUES(?, ?)`, [channelId, type], (err) => {
            if(err) {
                reject(err)
            } else {
                resolve()
            }
        })
    })
}

function removeChannelDbInfo({ channelId }) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM channels WHERE channelId = ?`, [channelId], (err) => {
            if(err) {
                reject(err)
            } else {
                resolve()
            }
        })
    })
}

function getChannelDbInfo({ channelId }) {
    return new Promise((resolve, reject) => {
        if(!channelId) {
            reject()
        }
        db.get(`SELECT * FROM channels WHERE channelId = ?`, [channelId], (err, row) => {
            if(err) {
                reject(err)
            }
            resolve(row)
        })
    })
}

function getChannelsDbInfo({ msg }) {
    return new Promise((resolve, reject) => {
        if(!msg.channel.id) {
            reject()
        }
        db.all(`SELECT * FROM channels`, (err, rows) => {
            if(err) {
                reject(err)
            }
            resolve(rows)
        })
    })
}

client.login(config.discord_token);
