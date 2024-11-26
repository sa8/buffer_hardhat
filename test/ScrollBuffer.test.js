const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ScrollBuffer Specification Tests", function () {
    let scrollBuffer;
    let owner;
    let user1;
    const initialStaked = ethers.parseEther("1000"); // Initial staked amount
    const SCALE = BigInt(100);
    const HEALTHY_BUFFER = BigInt(80);
    const BASE_TARGET_PERCENTAGE = BigInt(20);

    beforeEach(async function () {
        [owner, user1] = await ethers.getSigners();
        const ScrollBuffer = await ethers.getContractFactory("ScrollBuffer");
        scrollBuffer = await ScrollBuffer.deploy(initialStaked);
        await scrollBuffer.waitForDeployment();
    });

    describe("Target and Buffer Health Calculation", function () {
        it("should initialize with correct base target", async function () {
            const target = await ethers.provider.getStorage(await scrollBuffer.getAddress(), 2); // target storage slot
            const expectedTarget = (initialStaked * BASE_TARGET_PERCENTAGE) / SCALE;
            expect(target).to.equal(expectedTarget);
        });

        it("should calculate correct buffer health ratio", async function () {
            const currentTarget = await ethers.provider.getStorage(await scrollBuffer.getAddress(), 2); // target storage slot
            const bufferAmount = (BigInt(currentTarget) * BigInt(150)) / BigInt(100); // 1.5x target
            const health = await scrollBuffer.bufferHealth(bufferAmount);
            expect(health).to.equal(BigInt(150)); // 150% health
        });

        it("should handle zero buffer health case", async function () {
            const health = await scrollBuffer.bufferHealth(0);
            expect(health).to.equal(BigInt(0));
        });
    });

    describe("Target Update Mechanism", function () {
        it("should increase target when health is low", async function () {
            // Add small buffer to create low health
            await scrollBuffer.deposit({ value: ethers.parseEther("10") });
            const initialTargetHex = await ethers.provider.getStorage(await scrollBuffer.getAddress(), 2);
            const initialTarget = BigInt(initialTargetHex);
            
            await scrollBuffer.updateTarget();
            
            const newTargetHex = await ethers.provider.getStorage(await scrollBuffer.getAddress(), 2);
            const newTarget = BigInt(newTargetHex);
            expect(newTarget).to.be.gt(initialTarget);
        });

        it("should decrease target when health is high", async function () {
            // Add very large buffer to create high health
            await scrollBuffer.deposit({ value: ethers.parseEther("2000") });
            
            const initialTargetHex = await ethers.provider.getStorage(await scrollBuffer.getAddress(), 2);
            const initialTarget = BigInt(initialTargetHex);
            
            // Call update target
            await scrollBuffer.updateTarget();
            
            const newTargetHex = await ethers.provider.getStorage(await scrollBuffer.getAddress(), 2);
            const newTarget = BigInt(newTargetHex);
            
            // Verify target decreased
            expect(newTarget).to.be.lt(initialTarget);
            
            // Verify reasonable decrease
            // const totalAmount = await scrollBuffer.getTotalAmount();
            // const baseTarget = (totalAmount * BASE_TARGET_PERCENTAGE) / SCALE;
            // expect(newTarget).to.be.gte(baseTarget / BigInt(2)); // Should not go below 50% of base target
        });
        it("should not let target fall below 50% of base target", async function () {
            // Add huge buffer to create very high health
            await scrollBuffer.deposit({ value: ethers.parseEther("2000") });
            await scrollBuffer.updateTarget();
            
            const totalAmount = await scrollBuffer.getTotalAmount();
            const baseTarget = (totalAmount * BASE_TARGET_PERCENTAGE) / SCALE;
            const minTarget = baseTarget / BigInt(2);
            
            const newTarget = await ethers.provider.getStorage(await scrollBuffer.getAddress(), 2);
            expect(newTarget).to.be.gte(minTarget);
        });
    });

    describe("Withdrawal Slippage Implementation", function () {
        beforeEach(async function () {
            // Initialize with enough ETH to ensure healthy buffer
            await scrollBuffer.deposit({ 
                value: ethers.parseEther("1000")
            });
        });

        it("should allow full withdrawal when buffer health > HEALTHY_BUFFER", async function () {
            // First deposit some funds for user1
            await scrollBuffer.connect(user1).deposit({ value: ethers.parseEther("100") });
            
            const withdrawAmount = ethers.parseEther("10");
            const initialBalance = await ethers.provider.getBalance(user1);
            
            const tx = await scrollBuffer.connect(user1).curveWithdrawal(withdrawAmount);
            const receipt = await tx.wait();
            const gasSpent = receipt.gasUsed * tx.gasPrice;
            
            const finalBalance = await ethers.provider.getBalance(user1);
            const actualWithdrawn = finalBalance - initialBalance + gasSpent;
            
            expect(actualWithdrawn).to.equal(withdrawAmount);
        });

        it("should apply slippage when buffer health < HEALTHY_BUFFER", async function () {
            // First deposit some funds for user1
            await scrollBuffer.connect(user1).deposit({ value: ethers.parseEther("1000") });
            
            // Deplete buffer to unhealthy levels
            await scrollBuffer.connect(user1).curveWithdrawal(ethers.parseEther("900"));
            
            const withdrawAmount = ethers.parseEther("10");
            const initialBalance = await ethers.provider.getBalance(user1);
            
            const tx = await scrollBuffer.connect(user1).curveWithdrawal(withdrawAmount);
            const receipt = await tx.wait();
            const gasSpent = receipt.gasUsed * tx.gasPrice;
            
            const finalBalance = await ethers.provider.getBalance(user1);
            const actualWithdrawn = finalBalance - initialBalance + gasSpent;

            const bufferHealth = await scrollBuffer.bufferHealth(await ethers.provider.getBalance(await scrollBuffer.getAddress()));
            const expectedMultiplier = (BigInt(20) + bufferHealth);
            const expectedWithdrawal = (withdrawAmount * expectedMultiplier) / SCALE;
            
            expect(actualWithdrawn).to.be.approximately(expectedWithdrawal, ethers.parseEther("0.0001"));
        });

        it("should emit correct events on target update", async function () {
            await expect(scrollBuffer.updateTarget())
                .to.emit(scrollBuffer, "TargetUpdated")
                .and.to.emit(scrollBuffer, "StakeExecuted");
        });
    });

    describe("Stake and Unstake Triggers", function () {
        it("should trigger stake when buffer exceeds target", async function () {
            await scrollBuffer.deposit({ value: ethers.parseEther("1000") });
            
            await expect(scrollBuffer.updateTarget())
                .to.emit(scrollBuffer, "StakeExecuted");
        });

        it("should trigger unstake when buffer below target", async function () {
            // First deposit and update target
            await scrollBuffer.deposit({ value: ethers.parseEther("1000") });
            await scrollBuffer.updateTarget();
            
            // Then withdraw to create low buffer
            await scrollBuffer.connect(user1).deposit({ value: ethers.parseEther("1000") });
            await scrollBuffer.connect(user1).curveWithdrawal(ethers.parseEther("900"));
            
            await expect(scrollBuffer.updateTarget())
                .to.emit(scrollBuffer, "UnstakeExecuted");
        });
    });
});