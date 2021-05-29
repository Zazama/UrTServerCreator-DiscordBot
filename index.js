const Discord = require('discord.js');
const Axios = require('axios');
const { table } = require('table');
const client = new Discord.Client();
const config = require('./config/config.json')

const axios = Axios.create({
    baseURL: `${config.api_url}/bot`,
    headers: {
        Authorization: `Bearer ${config.api_bearer_token}`
    }
})

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

const prefix = config.prefix + ' '
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
        msg.channel.send('What do you want?')
    }

    switch (commands[0]) {
        case 'start':
            if(commands.length === 2) {
                handleServerStart({ msg, region: commands[1] })
            } else if(commands.length === 1) {
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
                let re = new RegExp(prefix + '[\\s]+rcon[\\s]+(?:.*?)[\\s]+(.*)', 'g')
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
${prefix} start
${prefix} start <region>
${prefix} stop`

    if(msg.member.hasPermission('ADMINISTRATOR')) {
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
              if(server.status === 'AVAILABLE') {
                  regions[server.region].AVAILABLE += 1
              }
              regions[server.region].COUNT += 1
          }
          let data = [['Region', 'Available servers']]
          for(let region of Object.keys(regions)) {
              data.push([region, `${regions[region].AVAILABLE}/${regions[region].COUNT}`])
          }
          msg.channel.send('\n`' + table(data).split('\n').filter(l => !!l).join('`\n`') + '`')
      })
      .catch(e => {
          console.error(e)
          msg.channel.send('There was an error reaching the backend.')
      })
}

function handleServers({ msg }) {
    if(!msg.member.hasPermission('ADMINISTRATOR')) {
        return
    }
    axios
        .get(`/server/${msg.guild.id}/pool`)
        .then((res) => {
            let data = [['ID', 'Address', 'RCON', 'Region', 'Status']]
            res.data.forEach(s => {
                data.push([s.id, `${s.ip}:${s.port}`, s.rconpassword, s.region, s.UrTServerStatus.status])
            })
            msg.channel.send('\n`' + table(data).split('\n').filter(l => !!l).join('`\n`') + '`')
        })
        .catch(e => {
            console.error(e)
            msg.channel.send('There was an error reaching the backend.')
        })
}

function handleAdd({ msg, ip, port, rconpassword, region }) {
    if(!msg.member.hasPermission('ADMINISTRATOR')) {
        return
    }

    axios
      .post(`/server/${msg.guild.id}/pool`, {
          ip, port, rconpassword, region
      })
      .then((res) => {
          msg.channel.send('Server added successfully.')
      })
      .catch(e => {
          console.error(e.response)
          msg.channel.send('There was an error reaching the backend.')
      })
}

function handleDelete({ msg, id }) {
    if(!msg.member.hasPermission('ADMINISTRATOR')) {
        return
    }

    axios
      .delete(`/server/${msg.guild.id}/pool/${id}`)
      .then((res) => {
          msg.channel.send('Server removed successfully.')
      })
      .catch(e => {
          if(e.response && e.response.status && e.response.status === 404) {
              msg.channel.send('This server does not exist.')
          } else {
              msg.channel.send('There was an error reaching the backend.')
          }
      })
}

function handleRcon({ msg, id, command }) {
    if(!msg.member.hasPermission('ADMINISTRATOR')) {
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
              msg.channel.send('This server does not exist.')
          } else {
              msg.channel.send('There was an error reaching the backend.')
          }
      })
}

function handleServerStart({ msg, region }) {
    requestServer({ serverId: msg.guild.id, userId: msg.author.id, region })
        .then(() => {
            msg.channel.send('Your server is queueing for creation! You will get a direct message with the IP address after it has started.')
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
                    throw 'There are no servers available right now, sorry!'
                case 'ALREADY_REQUESTED_SERVER':
                    throw `You already have a server running.\n\nTry ${prefix} stop`
            }
        }
        throw 'We are unable to request a server for you right now, sorry!'
    }
}

function handleServerStop({ msg }) {
    stopServer({ serverId: msg.guild.id, userId: msg.author.id })
        .then(() => {
            msg.channel.send('Thanks! Your server will be shut down...')
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
                    throw 'You don\'t have a server allocated for removal.'
            }
        }
        throw 'There was an error trying to stop your server. Please try again later.'
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

/connect ${address}; password ${password}

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
/ref exec uz2v2
/ref exec uz5v5bomb
/ref exec uz5v5cah
/ref exec uz5v5ctf
/ref exec uz5v5ft
/ref exec uz5v5ftl
/ref exec uz5v5nowave
/ref exec uz5v5tdm
/ref exec uz5v5ts

Your server will be online for the next two hours.`)
            } catch(e) {
                console.error(e)
            }
        }
    } catch(e) {
        console.error(e)
    }
}

function handleWrongCommand({ msg, command }) {
    msg.channel.send('You\'ve entered a wrong command.')
}

client.login(config.discord_token);
