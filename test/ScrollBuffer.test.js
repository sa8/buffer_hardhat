const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ScrollBuffer Specification Tests", function () {
    let scrollBuffer;
    let owner;
    let user1;
    const initialTarget = ethers.parseEther("100");
    const SCALE = 100;
    const HEALTHY_BUFFER = 80;

    beforeEach(async function () {
        [owner, user1] = await ethers.getSigners();
        const ScrollBuffer = await ethers.getContractFactory("ScrollBuffer");
        scrollBuffer = await ScrollBuffer.deploy(initialTarget);
        await scrollBuffer.waitForDeployment();
    });

    describe("Buffer Health Calculation", function () {
        it("should return scaled ratio when buffer exceeds target", async function () {
            const bufferAmount = ethers.parseEther("150"); // 1.5x target
            const health = await scrollBuffer.bufferHealth(bufferAmount);
            expect(health).to.equal(150); // 150/100 * SCALE
        });

        it("should return SCALE/2 when buffer is below target", async function () {
            const bufferAmount = ethers.parseEther("50"); // 0.5x target
            const health = await scrollBuffer.bufferHealth(bufferAmount);
            expect(health).to.equal(SCALE/2);
        });
    });

    describe("Withdrawal Slippage Implementation", function () {
        beforeEach(async function () {
            // Initialize with 150 ETH to ensure healthy buffer
            await scrollBuffer.connect(user1).deposit({ 
                value: ethers.parseEther("150")
            });
        });

        it("should allow full withdrawal when buffer health > HEALTHY_BUFFER", async function () {
            const withdrawAmount = ethers.parseEther("10");
            const initialBalance = await ethers.provider.getBalance(user1);
            
            const tx = await scrollBuffer.connect(user1).curveWithdrawal(withdrawAmount);
            const receipt = await tx.wait();
            const gasSpent = receipt.gasUsed * tx.gasPrice;
            
            const finalBalance = await ethers.provider.getBalance(user1);
            const actualWithdrawn = finalBalance - initialBalance + gasSpent;
            
            // Should get exact amount when healthy
            expect(actualWithdrawn).to.equal(withdrawAmount);
        });

        it("should apply correct slippage formula when buffer health < HEALTHY_BUFFER", async function () {
            // First withdraw enough to make buffer unhealthy
            await scrollBuffer.connect(user1).curveWithdrawal(ethers.parseEther("120"));
            
            const withdrawAmount = ethers.parseEther("10");
            const initialBalance = await ethers.provider.getBalance(user1);
            
            const tx = await scrollBuffer.connect(user1).curveWithdrawal(withdrawAmount);
            const receipt = await tx.wait();
            const gasSpent = receipt.gasUsed * tx.gasPrice;
            
            const finalBalance = await ethers.provider.getBalance(user1);
            const actualWithdrawn = finalBalance - initialBalance + gasSpent;

            // Calculate expected withdrawal based on formula: amount * (0.2 + buffer_health)
            // When buffer is low, health = SCALE/2 = 50
            // Expected multiplier = (20 + 50)/100 = 0.7
            const expectedWithdrawal = withdrawAmount * 7n / 10n;
            
            // Allow for minor rounding differences due to gas calculations
            const difference = expectedWithdrawal - actualWithdrawn;
            expect(Math.abs(Number(difference))).to.be.lessThan(Number(ethers.parseEther("0.0001")));
        });

        it("should enforce minimum withdrawal multiplier", async function () {
            // Withdraw almost everything to create very low health
            await scrollBuffer.connect(user1).curveWithdrawal(ethers.parseEther("145"));
            
            const withdrawAmount = ethers.parseEther("1");
            const tx = await scrollBuffer.connect(user1).curveWithdrawal(withdrawAmount);
            const receipt = await tx.wait();
            
            // Get withdrawal event
            const event = receipt.logs[0];
            const iface = new ethers.Interface([
                "event Withdrawal(address indexed user, uint256 requested, uint256 received)"
            ]);
            const decodedEvent = iface.parseLog(event);
            
            // Minimum multiplier should be (20 + 50)/100 = 0.7
            const minimumWithdrawal = withdrawAmount * 7n / 10n;
            expect(decodedEvent.args.received).to.be.approximately(minimumWithdrawal, ethers.parseEther("0.0001"));
        });
    });
});