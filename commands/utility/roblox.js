const {InteractionContextType, SlashCommandBuilder, AttachmentBuilder} = require('discord.js');
const {execFile} = require('child_process');
const {promisify} = require('util');
const fs = require('fs');
const path = require('path');

const execFilePromise = promisify(execFile);

function getLoudness(filePath) {
    return new Promise(function(resolve, reject) {
        execFilePromise("ffmpeg", ["-i", filePath, "-af", "ebur128=peak=true", "-f", "null", "-"], (_, __, stderr) => {
            console.log(stderr)
            if (!stderr) return reject(new Error("no output from ffmpeg ???"));

            resolve({
                lufs: parseFloat(stderr.match(/Integrated loudness[\s\S]*?I:\s+([-\d.]+) LUFS/)?.[1]),
                peak: parseFloat(stderr.match(/Peak:\s+([-\d.]+) dBFS/)?.[1]),
            });
        });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roblox')
        .setDescription('roblox audio compression simulation to test audio files and their results in the future.')
        .addAttachmentOption((option) => 
            option.setName('file')
                .setDescription('annihilate him')
                .setRequired(true)
        )
        .addNumberOption((option) =>
			option.setName('quality')
				.setDescription('the quality of the ogg so u can test compression and stuff')
				.setRequired(false)
		)
        .setContexts([InteractionContextType.Guild, InteractionContextType.PrivateChannel, InteractionContextType.BotDM]),
    
    async execute(interaction) {
        await interaction.deferReply();

        const attachment = interaction.options.getAttachment('file');
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const timestamp = Date.now();
        const originalExt = path.extname(attachment.name) || `.mp3`;
        const inputPath = path.join(tempDir, `input_${timestamp}${originalExt}`);
        const firstPassPath = path.join(tempDir, `roblox_pass1_${timestamp}.ogg`);
        const secondPassPath = path.join(tempDir, `roblox_pass2_${timestamp}.ogg`);
        const waveformPath = path.join(tempDir, `waveform_roblox_${timestamp}.png`);

        const quality = interaction.options.getNumber('quality') ?? 0.5;

        try {
            await interaction.editReply('downloading file...');
            const response = await fetch(attachment.url);
            const buffer = await response.arrayBuffer();
            fs.writeFileSync(inputPath, Buffer.from(buffer));

            await interaction.editReply('first compression pass...');
            await execFilePromise("ffmpeg", [
                "-i", inputPath,
				"-af", "aformat=sample_fmts=s16",
                "-c:a", "libvorbis",
                "-q:a", quality,
                "-y",
                firstPassPath
            ]);

            await interaction.editReply('second compression pass... (ty kaid)');
            await execFilePromise("ffmpeg", [
                "-i", firstPassPath,
                "-c:a", "libvorbis",
                "-q:a", quality,
                "-y",
                secondPassPath
            ]);

            await interaction.editReply('analyzing file...');
            const [probeResult, loudness] = await Promise.all([
                execFilePromise("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", secondPassPath]),
                getLoudness(secondPassPath),
            ]);

            const data = JSON.parse(probeResult.stdout);
            const fmt = data.format;
            const stream = data.streams.find(s => s.codec_type === "audio");

            const waveformSize = "1920x660";

            const peakColor = "3232C8"
            const rmsColor = "6464DC"
            await execFilePromise("ffmpeg", [
                "-i", secondPassPath,
                "-filter_complex", `[0:a]showwavespic=s=${waveformSize}:colors=${peakColor}:filter=peak:split_channels=1[peaks];[0:a]showwavespic=s=${waveformSize}:colors=${rmsColor}:filter=average:split_channels=1[rms];[peaks][rms]overlay`,
                "-update", "1", waveformPath
            ]);

            const duration = parseFloat(fmt.duration);
            const minutes = Math.floor(duration / 60);
            const seconds = Math.floor(duration % 60);

            await interaction.editReply({
                content:
                    `processed \`${attachment.name}\`\n` +
                    `duration: ${minutes}:${seconds.toString().padStart(2, "0")}\n` +
                    `bitrate: ${Math.round(fmt.bit_rate / 1000)} kbps\n` +
                    `sample rate: ${stream.sample_rate}hz\n` +
                    `integrated: ${loudness.lufs} LUFS\n` +
                    `peak: ${loudness.peak} dBFS`,
                files: [
                    new AttachmentBuilder(waveformPath, { name: "waveform.png" }),
                    new AttachmentBuilder(secondPassPath, { name: `${attachment.name.replace(/\.[^/.]+$/, "")}.ogg` })
                ]
            });

            fs.unlinkSync(inputPath);
            fs.unlinkSync(firstPassPath);
            fs.unlinkSync(secondPassPath);
            fs.unlinkSync(waveformPath);

        } catch (error) {
            console.error("Roblox processing failed:", error);
            await interaction.editReply(`Error processing file: ${error.message}`);
            
            [inputPath, firstPassPath, secondPassPath, waveformPath].forEach(file => {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            });
        }
    }
}
