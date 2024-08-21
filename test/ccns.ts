import { changeNetwork, config, ethers, network } from "hardhat";
import { expect } from "chai";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import {
  CCIPLocalSimulator,
  CCIPLocalSimulator__factory,
  CrossChainNameServiceLookup,
  CrossChainNameServiceLookup__factory,
  CrossChainNameServiceReceiver,
  CrossChainNameServiceReceiver__factory,
  CrossChainNameServiceRegister,
  CrossChainNameServiceRegister__factory
} from "../typechain-types";

import "../tasks";
import { __deploymentsPath, getDeploymentInfo, getRouterConfig } from "../tasks/utils";


describe("CCIP cross-chain name service", async function () {
  async function localSimulatorConfig() {
    const [alice] = await ethers.getSigners();

    const localSimulatorFactory: CCIPLocalSimulator__factory = await ethers.getContractFactory('CCIPLocalSimulator');
    const localSimulator: CCIPLocalSimulator = await localSimulatorFactory.connect(alice).deploy();
    await localSimulator.deployed();

    const config = await localSimulator.configuration();

    return {
      sourceRouter: config.sourceRouter_,
      destinationRouter: config.destinationRouter_,
      alice: alice
    }
  };

  /** Setup the Cross Chain Name Service on the source network by deploying Lookup and Register smart contracts and linking them 
   * @param router Address of the Chainlink CCIP Router contract on the source blockchain
  */
  async function sourceChainDeploy(router: any) {
    if (network.name !== config.defaultNetwork) {
      return;
    }

    const [deployer] = await ethers.getSigners();

    const ccnsLookupFactory: CrossChainNameServiceLookup__factory = await ethers.getContractFactory('CrossChainNameServiceLookup');
    const crossChainLookup: CrossChainNameServiceLookup = await ccnsLookupFactory.connect(deployer).deploy();
    await crossChainLookup.deployed();

    const routerAddress = router ? router : getRouterConfig(network.name).address;

    const ccnsRegisterFactory: CrossChainNameServiceRegister__factory = await ethers.getContractFactory('CrossChainNameServiceRegister');
    const crossChainRegister: CrossChainNameServiceRegister = await ccnsRegisterFactory.deploy(routerAddress, crossChainLookup.address);
    await crossChainRegister.deployed();

    const filePath = join(__deploymentsPath, `${network.name}.json`);
    !existsSync(__deploymentsPath) && mkdirSync(__deploymentsPath);

    let data;
    try {
      data = {
        "network": network.name,
        "ccnsRegister": crossChainRegister.address,
        "ccnsLookup": crossChainLookup.address
      };

      writeFileSync(filePath, JSON.stringify(data));
    } catch (error) {
      console.error(`Error: ${error}`);
    }

    const tx = await crossChainLookup.setCrossChainNameServiceAddress(crossChainRegister.address);
    await tx.wait();

    return data;
  }


  /** Sets up the Cross Chain Name Service on the destination network by deployed Lookup and Receiver smart contracts and linking them
     * @param register CrossChainNameServiceRegister smart contract address
     * @param scSelector Source Chain Selector
     * @param router Address of the Chainlink CCIP Router contract on the destination blockchain
     */
  async function destinationChainDeploy(register: any, router: any, deployer: any) {
    if (network.name === config.defaultNetwork) {
      return;
    }

    const ccnsRegisterAddress = register ? register : getDeploymentInfo(config.defaultNetwork).ccnsRegister;

    if (!ccnsRegisterAddress) {
      return;
    }

    const ccnsLookupFactory: CrossChainNameServiceLookup__factory = await ethers.getContractFactory('CrossChainNameServiceLookup');
    const crossChainLookup: CrossChainNameServiceLookup = await ccnsLookupFactory.connect(deployer).deploy();
    await crossChainLookup.deployed();

    const routerAddress = router ? router : getRouterConfig(network.name).address;
    const sourceChainSelector = getRouterConfig(config.defaultNetwork).chainSelector;

    const ccnsReceiverFactory: CrossChainNameServiceReceiver__factory = await ethers.getContractFactory('CrossChainNameServiceReceiver');
    const crossChainReceiver: CrossChainNameServiceReceiver = await ccnsReceiverFactory.connect(deployer).deploy(routerAddress, crossChainLookup.address, sourceChainSelector);
    await crossChainReceiver.deployed();

    const filePath = join(__deploymentsPath, `${network.name}.json`);
    !existsSync(__deploymentsPath) && mkdirSync(__deploymentsPath);

    let data;
    try {
      data = {
        "network": network.name,
        "ccnsReceiver": crossChainReceiver.address,
        "ccnsLookup": crossChainLookup.address
      };

      writeFileSync(filePath, JSON.stringify(data));
    } catch (error) {
      console.error(`Error: ${error}`);
    }

    const tx = await crossChainLookup.connect(deployer).setCrossChainNameServiceAddress(crossChainReceiver.address);
    await tx.wait();

    return data;
  }

  /** Enables previously deployed CrossChainNameServiceReceiver contract on the source chain
   * @param receiverNetwork The network you used in the deployDestinationChainStep1 function
   * @param register CrossChainNameServiceRegister smart contract address
   * @param receiver CrossChainNameServiceReceiver smart contract address
   * @param dcSelector Destination Chain Selector
   */
  async function enableReceiver(receiverNetwork: any, register: any, receiver: any, caller: any) {
    if (network.name !== config.defaultNetwork) {
      return;
    }

    const ccnsRegisterAddress = register ? register : getDeploymentInfo(config.defaultNetwork).ccnsRegister;

    if (!ccnsRegisterAddress) {
      return;
    }

    const destinationChainSelector = getRouterConfig(receiverNetwork).chainSelector;
    const ccnsReceiverAddress = receiver ? receiver : getDeploymentInfo(receiverNetwork).ccnsReceiver;

    const crossChainRegister: CrossChainNameServiceRegister = CrossChainNameServiceRegister__factory.connect(ccnsRegisterAddress, caller);

    const tx = await crossChainRegister.connect(caller).enableChain(destinationChainSelector, ccnsReceiverAddress, 200_000);
    await tx.wait();
  }

  /** Register new .ccns name
   * @param ccnsName CCNS Name you want to register, it must ends with .ccns
   * @param register CrossChainNameServiceRegister smart contract address
  */
  async function register(ccnsName: any, register: any, caller: any) {
    if (network.name !== config.defaultNetwork) {
      return;
    }

    if (!ccnsName.endsWith(`.ccns`)) {
      return;
    }

    const ccnsRegisterAddress = register ? register : getDeploymentInfo(config.defaultNetwork).ccnsRegister;

    if (!ccnsRegisterAddress) {
      return;
    }

    const crossChainRegister: CrossChainNameServiceRegister = CrossChainNameServiceRegister__factory.connect(ccnsRegisterAddress, caller);

    const tx = await crossChainRegister.connect(caller).register(ccnsName);
    await tx.wait();
  }

  async function lookup(ccnsName: any, lookup: any, caller: any) {
    const ccnsLookupAddress = lookup ? lookup : getDeploymentInfo(network.name).crossChainLookup;

    if (!ccnsLookupAddress) {
      return;
    }

    const crossChainLookup: CrossChainNameServiceLookup = CrossChainNameServiceLookup__factory.connect(ccnsLookupAddress, ethers.provider);

    const address = await crossChainLookup.connect(caller).lookup(ccnsName);

    return address;
  }

  it("should register and lookup cross-chain service", async () => {
    const { sourceRouter, destinationRouter, alice }: any = await localSimulatorConfig();
    const ALICE_CCNS = "alice.ccns";
    const DESTINATION_CHAIN = "optimismSepolia";

    /** 
    * Creation of instances of CrossChainNameServiceLookup.sol and CrossChainNameServiceRegister.sol on source chain
    */
    const sourceChainInfo: { network: any, ccnsRegister: any, ccnsLookup: any } | undefined = await sourceChainDeploy(sourceRouter);

    /** 
    * Creation of instances of CrossChainNameServiceLookup.sol and CrossChainNameServiceReceiver.sol on destination chain
    */
    changeNetwork(DESTINATION_CHAIN);
    const destinationChainInfo: { network: any, ccnsReceiver: any, ccnsLookup: any } | undefined = await destinationChainDeploy(sourceChainInfo?.ccnsRegister, destinationRouter, alice);

    /** 
    * Enable the previously deployed CrossChainNameServiceReceiver contract
    */
    changeNetwork(config.defaultNetwork);
    await enableReceiver(DESTINATION_CHAIN, sourceChainInfo?.ccnsRegister, destinationChainInfo?.ccnsReceiver, alice);

    await register(ALICE_CCNS, sourceChainInfo?.ccnsRegister, alice);

    const sourceAddress = await lookup(ALICE_CCNS, sourceChainInfo?.ccnsLookup, alice);

    expect(sourceAddress).to.equal(alice.address);

    changeNetwork(DESTINATION_CHAIN);

    const destinationAddress = await lookup(ALICE_CCNS, destinationChainInfo?.ccnsLookup, alice);

    expect(destinationAddress).to.equal(alice.address);
  }).timeout(1000000);
});