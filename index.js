const Discord = require('discord.js')
const Axios = require('axios')
const { table } = require('table')
const client = new Discord.Client()
const config = require('./config/config.json')
const fs = require('fs')

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

client.on('message', msg => {
    if(msg.author.bot || msg.channel.type !== 'text') return
    if(!msg.content.startsWith(prefix)) return
    let commands = msg.content
        .substring(prefix.length)
        .trim()
        .replace(/\s\s+/g, ' ')
        .split(' ')
    parseCommands({ commands, msg })
});

function parseCommands({ commands = [], msg }) {
    if(commands.length === 0) {
        return
    }

    switch (commands[0]) {
        case 'start':
            if(commands.length === 2) {
                handleServerStart({ msg, region: commands[1] })
            } else if(commands.length === 1 && config.allow_random_region) {
                handleServerStart({ msg })
            } else {
                handleWrongCommand({ msg, command: 'start' })
            }
            break
        case 'stop':
            if(commands.length !== 1) {
                handleWrongCommand({ msg, command: 'stop' })
            } else {
                handleServerStop({ msg })
            }
            break
        case 'servers':
            handleServers({ msg })
            break
        case 'available':
            handleAvailable({ msg })
            break
        case 'add':
            if(commands.length !== 4 && commands.length !== 5) {
                handleWrongCommand({msg, command: 'add'})
            } else {
                handleAdd({
                    msg,
                    ip: commands[1],
                    port: commands[2],
                    rconpassword: commands[3],
                    region: commands[4]
                })
            }
            break
        case 'delete':
            if(commands.length !== 2) {
                handleWrongCommand({msg, command: 'delete'})
            } else {
                handleDelete({
                    msg,
                    id: commands[1]
                })
            }
            break
        case 'rcon':
            if(commands.length < 3) {
                handleWrongCommand({msg, command: 'rcon'})
            } else {
                let re = new RegExp(prefix + '[\\s]*rcon[\\s]+(?:.*?)[\\s]+(.*)', 'g')
                let exec = re.exec(msg.content)
                if(exec && exec[1]) {
                    handleRcon({ msg, id: commands[1], command: exec[1] })
                }
            }
            break
        case 'help':
            handleHelp({ msg })
            break
        default:
            handleWrongCommand({ msg })
    }
}

function handleHelp({ msg }) {
    let helpString = `**Available commands:**
${prefix} available
`
    if(config.allow_random_region) {
        helpString += `${prefix} start\n`
    }
helpString += `${prefix} start <region>
${prefix} stop`

    if(fromAdmin({ msg })) {
        helpString += `

**Admin commands**:
${prefix} servers
${prefix} add <ip> <port> <rconpassword> <optional region>
${prefix} delete <id>
${prefix} rcon <id> <command>
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
    if(!fromAdmin({ msg })) {
        return
    }
    axios
        .get(`/server/${msg.guild.id}/pool`)
        .then((res) => {
            let data = [['ID', 'Address', 'RCON', 'Region', 'Status']]
            let inUse = []
            res.data.forEach(s => {
                data.push([s.id, `${s.ip}:${s.port}`, s.rconpassword, s.region, s.UrTServerStatus.status])
                if(s.UrTServerStatus.status === 'IN_USE') {
                    inUse.push([`[${s.id}] /connect ${s.ip}; password ${s.UrTServerStatus.password}; rconpassword ${s.rconpassword}`])
                }
            })
            msg.channel.send('```' + table(data) + '\n\n' + inUse.join('\n') + '```')
        })
        .catch(e => {
            console.error(e)
            msg.channel.send(strings.API_ERROR)
        })
}

function handleAdd({ msg, ip, port, rconpassword, region }) {
    if(!fromAdmin({ msg })) {
        return
    }

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

function handleDelete({ msg, id }) {
    if(!fromAdmin({ msg })) {
        return
    }

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

function handleRcon({ msg, id, command }) {
    if(!fromAdmin({ msg })) {
        return
    }

    axios
      .post(`/server/${msg.guild.id}/pool/${id}/rcon`, {
          command
      })
      .then((res) => {
          msg.channel.send('```\n' + res.data.data + '\n```')
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

function handleServerStart({ msg, region }) {
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

function handleServerStop({ msg }) {
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
`Your server is ready!

**connect ${address}; password ${password}**

/reflogin ${refpass}

**Administration**
/ref mute <player>
/ref forceteam <player>
/ref kick <player>
/ref ban <player>
/ref veto
/ref swap
/ref reload
/ref restart
/ref pause
/ref map <map>
/ref nextmap <map>
/ref cyclemap

**Configs**
/ref exec uz5v5ctf
(uz2v2, uz5v5bm, uz5v5cah, uz5v5ctf, uz5v5ft, uz5v5ftl, uz5v5nowave, uz5v5tdm, uz5v5ts, ncbomb, ncctf, ncts, knockout, skeetshoot)

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

client.login(config.discord_token);
